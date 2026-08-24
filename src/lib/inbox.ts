import type { Store } from "./db";
import { listMailboxes, type Mailbox } from "./mailboxes";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// A message that LOOKS like a delivery notice — deliberately broad, because this only
// selects candidates whose body we then read. The subject alone cannot decide: Gmail
// ships both permanent failures and temporary delays as "Delivery Status Notification",
// and even sends a transient "inbox full" under "(Failure)".
const BOUNCE_CANDIDATE_SUBJECT =
  /(delivery (status|incomplete|has failed)|undelivered|returned to sender|failure notice|address not found|delivery failure|mail delivery failed)/i;

// Temporary conditions. Checked FIRST so it overrides any incidental permanent-looking
// text in a quoted original message — the same ordering the send path uses. Marking one
// of these "bounced" is a false positive: the mail is often delivered on retry, and the
// recipient would be dropped from follow-ups forever and inflate the bounce rate.
const TRANSIENT_BOUNCE =
  /\b4\.\d\.\d\b|\b4\d\d[ -]|notification \(delay\)|will retry|temporary (?:problem|failure|error)|temporarily|delivery incomplete|warning message only|not yet been delivered|inbox (?:is )?full|over quota|quota exceeded|mailbox full|greylist|deferred|try again|throttl|rate ?limit|too many|timed? ?out|connection (?:timed out|refused)/i;

// Genuinely permanent: the address does not exist or was rejected outright. Mirrors
// PERMANENT_SEND_ERROR in sender.ts — a bare 550 is NOT enough on its own.
const PERMANENT_BOUNCE =
  /5\.1\.[01]\b|5\.0\.0\b|no such (?:user|mailbox|recipient)|user unknown|unknown user|does ?n['’]?t exist|does not exist|mailbox (?:not found|unavailable|disabled|does not exist)|address (?:rejected|not found)|recipient (?:rejected|not found)|invalid recipient|no mailbox|failed permanently|permanent (?:error|failure)|account that you tried to reach does not exist|couldn['’]?t be found/i;

// Bounce notices name the failed address in structured DSN headers. Prefer those over
// scraping every address in the body: the notice quotes the original message, so a
// broad scan can mis-mark anyone whose address appears in a quoted thread.
const DSN_RECIPIENT_RE = /^(?:final-recipient|original-recipient|x-failed-recipients)\s*:\s*(?:rfc822;)?\s*(.+)$/gim;

function failedAddressesFrom(raw: string): Set<string> {
  const out = new Set<string>();
  for (const m of raw.matchAll(DSN_RECIPIENT_RE)) {
    for (const e of (m[1].match(EMAIL_RE) || [])) out.add(e.toLowerCase());
  }
  return out;
}

export type MailboxScan = {
  id: string;
  host: string;
  ok: boolean;
  scanned: number;
  replies: number;
  bounces: number;
  deferred: number;      // transient notices (delay, inbox full) deliberately not bounced
  unclassified: number;  // daemon mail with no clear permanent signal
  error?: string;
};

export type InboxScan = {
  enabled: boolean;
  scanned: number;
  replies: number;
  bounces: number;
  deferred: number;
  unclassified: number;
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
  // Notices we deliberately did NOT treat as bounces — surfaced so "why is the bounce
  // count lower than the number of daemon mails" has a visible answer.
  let deferred = 0, unclassified = 0;
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
      // Carry the subject with each candidate: "(Delay)" appears in the subject while
      // the body may still read like a failure, so both are checked before marking.
      const bounceUids: { uid: number; subject: string }[] = [];
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
        // Bounce candidate: from a mail daemon or a failure-ish subject. Candidacy is
        // deliberately loose — the body decides whether it is actually permanent.
        if (/mailer-daemon|postmaster|mail delivery/i.test(from) ||
            BOUNCE_CANDIDATE_SUBJECT.test(subject)) {
          if (msg.uid) bounceUids.push({ uid: msg.uid, subject });
        }
      }

      // Read each notice and decide permanent vs temporary from its body, where the
      // real signal lives ("will retry for 47 more hours" vs "address not found").
      for (const { uid, subject } of bounceUids) {
        try {
          const dl = await client.download(String(uid), undefined, { uid: true });
          const chunks: Buffer[] = [];
          for await (const c of dl.content) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const text = raw.toLowerCase();

          // Transient first: a delay, a full mailbox or a greylist is not a bounce.
          // The mail is usually delivered on retry, so leave the recipient alone.
          if (TRANSIENT_BOUNCE.test(subject) || TRANSIENT_BOUNCE.test(text)) { deferred++; continue; }
          if (!PERMANENT_BOUNCE.test(text)) { unclassified++; continue; }

          // Prefer the DSN's own Final-Recipient header; fall back to a body scan only
          // when the notice carries no structured header at all.
          let found = failedAddressesFrom(raw);
          if (!found.size) found = new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()));
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
    return { id: box.id, host: box.imapHost, ok: true, scanned, replies, bounces, deferred, unclassified };
  } catch (e) {
    try { await client?.logout(); } catch {}
    return { id: box.id, host: box.imapHost, ok: false, scanned, replies, bounces, deferred, unclassified, error: (e as Error).message };
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
  if (!boxes.length) return { enabled: false, scanned: 0, replies: 0, bounces: 0, deferred: 0, unclassified: 0, mailboxes: [] };

  // Lean lookup: only id/email for recipients already sent and not yet replied/bounced
  // (avoids pulling every recipient row, all columns, on every dispatch tick).
  const recipients = await store.recipientsToReconcile();
  const byEmail = new Map<string, string[]>();
  for (const r of recipients) {
    if (!r.email) continue;
    const k = r.email.toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), r.id]);
  }
  if (byEmail.size === 0) return { enabled: true, scanned: 0, replies: 0, bounces: 0, deferred: 0, unclassified: 0, mailboxes: [] };

  // Scanned concurrently: the dispatch tick runs under a wall-clock budget, so total
  // time should be the slowest mailbox rather than the sum of all of them.
  const claimed = new Set<string>();
  const results = await Promise.all(boxes.map((b) => scanOne(store, b, byEmail, claimed)));

  const scanned = results.reduce((n, r) => n + r.scanned, 0);
  const replies = results.reduce((n, r) => n + r.replies, 0);
  const bounces = results.reduce((n, r) => n + r.bounces, 0);
  const deferred = results.reduce((n, r) => n + r.deferred, 0);
  const unclassified = results.reduce((n, r) => n + r.unclassified, 0);
  const failed = results.filter((r) => !r.ok);
  return {
    enabled: true,
    scanned,
    replies,
    bounces,
    deferred,
    unclassified,
    // Surface failures without hiding partial success — a mailbox that cannot be read
    // is a silent follow-up hazard, so it must be visible in the dispatch result.
    ...(failed.length ? { error: `${failed.length}/${results.length} mailboxes unreadable: ${failed.map((f) => `${f.id} (${f.error})`).join("; ")}` } : {}),
    mailboxes: results,
  };
}
