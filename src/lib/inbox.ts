import type { Store } from "./db";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Read the Gmail inbox over IMAP (same App Password as SMTP) and auto-update
// recipient statuses: a message FROM a recipient = "replied"; a bounce notice
// (mailer-daemon / delivery failure) naming a recipient = "bounced".
export async function scanInbox(store: Store): Promise<{ enabled: boolean; scanned: number; replies: number; bounces: number; error?: string }> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return { enabled: false, scanned: 0, replies: 0, bounces: 0 };

  // Lean lookup: only id/email for recipients already sent and not yet replied/bounced
  // (avoids pulling every recipient row, all columns, on every dispatch tick).
  const recipients = await store.recipientsToReconcile();
  const byEmail = new Map<string, string[]>();
  for (const r of recipients) {
    if (!r.email) continue;
    const k = r.email.toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), r.id]);
  }
  if (byEmail.size === 0) return { enabled: true, scanned: 0, replies: 0, bounces: 0 };

  let replies = 0, bounces = 0, scanned = 0;
  let client: import("imapflow").ImapFlow | null = null;
  try {
    const { ImapFlow } = await import("imapflow");
    client = new ImapFlow({
      host: process.env.IMAP_HOST || "imap.gmail.com",
      port: Number(process.env.IMAP_PORT || 993),
      secure: true,
      auth: { user, pass },
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
          for (const id of byEmail.get(from)!) { await store.recordEvent(id, "replied"); replies++; }
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
              for (const id of byEmail.get(email)!) { await store.recordEvent(id, "bounced"); bounces++; }
            }
          }
        } catch { /* skip unreadable message */ }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    return { enabled: true, scanned, replies, bounces };
  } catch (e) {
    try { await client?.logout(); } catch {}
    return { enabled: true, scanned, replies, bounces, error: (e as Error).message };
  }
}
