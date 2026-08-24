import type { Store } from "./db";
import { listMailboxes, type Mailbox } from "./mailboxes";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export type MailboxScan = {
  id: string;
  host: string;
  ok: boolean;
  scanned: number;
  replies: number;
  bounces: number;
  error?: string;
};

export type InboxScan = {
  enabled: boolean;
  scanned: number;
  replies: number;
  bounces: number;
  error?: string;
  mailboxes: MailboxScan[];
};

/**
 * Read ONE mailbox over IMAP and reconcile recipient statuses: a message FROM a
 * recipient = "replied"; a bounce notice naming a recipient = "bounced".
 *
 * `claimed` is shared across mailboxes so a recipient is only counted once even if
 * two mailboxes somehow see the same reply — the status write is idempotent, but the
 * reported numbers should not double.
 */
async function scanOne(
  store: Store,
  box: Mailbox,
  byEmail: Map<string, string[]>,
  claimed: Set<string>,
): Promise<MailboxScan> {
  let replies = 0, bounces = 0, scanned = 0;
  let client: import("imapflow").ImapFlow | null = null;
  try {
    const { ImapFlow } = await import("imapflow");
    client = new ImapFlow({
      host: box.imapHost,
      port: box.imapPort,
      secure: true,
      auth: { user: box.user, pass: box.pass },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const bounceUids: number[] = [];
      for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
        scanned++;
        const env = msg.envelope;
        const from = (env?.from?.[0]?.address || "").toLowerCase();
        const subject = env?.subject || "";
        if (!from) continue;

        // Reply: sender is one of our recipients
        if (byEmail.has(from)) {
          // mailto: List-Unsubscribe lands here as a reply with an "unsubscribe" subject.
          // Honor any opt-out intent globally, then record the reply.
          if (/unsubscribe|remove me|opt[\s-]?out|stop emailing/i.test(subject)) {
            await store.suppress(from, "unsubscribe-reply");
          }
          for (const id of byEmail.get(from)!) {
            await store.recordEvent(id, "replied");
            if (!claimed.has(id)) { claimed.add(id); replies++; }
          }
          continue;
        }
        // Bounce candidate: from a mail daemon or a failure subject
        if (/mailer-daemon|postmaster|mail delivery/i.test(from) ||
            /(delivery (status|incomplete|has failed)|undelivered|returned to sender|failure notice|address not found)/i.test(subject)) {
          if (msg.uid) bounceUids.push(msg.uid);
        }
      }

      // For bounce notices, read the body and find which of our recipients failed.
      for (const uid of bounceUids) {
        try {
          const dl = await client.download(String(uid), undefined, { uid: true });
          const chunks: Buffer[] = [];
          for await (const c of dl.content) chunks.push(c as Buffer);
          const text = Buffer.concat(chunks).toString("utf8").toLowerCase();
          const found = new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()));
          for (const email of found) {
            if (byEmail.has(email)) {
              for (const id of byEmail.get(email)!) {
                await store.recordEvent(id, "bounced");
                if (!claimed.has(id)) { claimed.add(id); bounces++; }
              }
            }
          }
        } catch { /* skip unreadable message */ }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    return { id: box.id, host: box.imapHost, ok: true, scanned, replies, bounces };
  } catch (e) {
    try { await client?.logout(); } catch {}
    return { id: box.id, host: box.imapHost, ok: false, scanned, replies, bounces, error: (e as Error).message };
  }
}

/**
 * Reconcile replies and bounces across EVERY configured mailbox.
 *
 * This used to read only SMTP_USER's inbox, so a prospect who replied to any other
 * sending address was never marked "replied" — and since dueFollowups() gates on that
 * status, they kept receiving follow-ups even after asking to stop. Each mailbox is now
 * scanned with its own credentials against its own IMAP host, independently: one
 * mailbox failing to authenticate never silences the others, it just reports its error.
 */
export async function scanInbox(store: Store): Promise<InboxScan> {
  const boxes = listMailboxes();
  if (!boxes.length) return { enabled: false, scanned: 0, replies: 0, bounces: 0, mailboxes: [] };

  // Lean lookup: only id/email for recipients already sent and not yet replied/bounced
  // (avoids pulling every recipient row, all columns, on every dispatch tick).
  const recipients = await store.recipientsToReconcile();
  const byEmail = new Map<string, string[]>();
  for (const r of recipients) {
    if (!r.email) continue;
    const k = r.email.toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), r.id]);
  }
  if (byEmail.size === 0) return { enabled: true, scanned: 0, replies: 0, bounces: 0, mailboxes: [] };

  // Scanned concurrently: the dispatch tick runs under a wall-clock budget, so total
  // time should be the slowest mailbox rather than the sum of all of them.
  const claimed = new Set<string>();
  const results = await Promise.all(boxes.map((b) => scanOne(store, b, byEmail, claimed)));

  const scanned = results.reduce((n, r) => n + r.scanned, 0);
  const replies = results.reduce((n, r) => n + r.replies, 0);
  const bounces = results.reduce((n, r) => n + r.bounces, 0);
  const failed = results.filter((r) => !r.ok);
  return {
    enabled: true,
    scanned,
    replies,
    bounces,
    // Surface failures without hiding partial success — a mailbox that cannot be read
    // is a silent follow-up hazard, so it must be visible in the dispatch result.
    ...(failed.length ? { error: `${failed.length}/${results.length} mailboxes unreadable: ${failed.map((f) => `${f.id} (${f.error})`).join("; ")}` } : {}),
    mailboxes: results,
  };
}
