// Configurable sending mailboxes. The primary mailbox comes from SMTP_USER /
// SMTP_PASS / EMAIL_FROM; additional mailboxes are numbered slots
// SMTP_USER_2..5 / SMTP_PASS_2..5 / EMAIL_FROM_2..5. Campaigns store a `fromMailbox`
// (the address) to pick one.
//
// Each slot may live on a different provider: a Gmail sender uses an App Password on
// smtp.gmail.com (the default), while a custom-domain mailbox (e.g. hello@xambaaz.com
// on Hostinger) sets its own SMTP_HOST_n / SMTP_PORT_n and authenticates with the real
// mailbox password. Host/port travel with the mailbox so one campaign's sender can be
// Gmail and another's a custom domain.

export type Mailbox = {
  id: string; // the lowercased sending address — stable id stored on campaigns
  label: string; // display string for the dropdown
  from: string; // EMAIL_FROM value, e.g. `Brand Vibe <brandvibe2k26@gmail.com>`
  user: string; // SMTP username
  pass: string; // SMTP password / App Password
  replyTo: string; // where replies land (the mailbox's own address)
  host: string; // SMTP host, e.g. smtp.gmail.com or smtp.hostinger.com
  port: number; // SMTP port (465 = SSL, 587 = STARTTLS)
  imapHost: string; // IMAP host for reading THIS mailbox's replies
  imapPort: number; // IMAP port (993 = implicit TLS)
};

// Every provider we use names its IMAP host the same as its SMTP host with the
// service swapped (smtp.gmail.com -> imap.gmail.com, smtp.hostinger.com ->
// imap.hostinger.com), so derive rather than making the caller configure both.
// SMTP_HOST_n's counterpart IMAP_HOST_n overrides it when a provider differs.
function deriveImapHost(smtpHost: string): string {
  return /^smtp\./i.test(smtpHost) ? smtpHost.replace(/^smtp\./i, "imap.") : smtpHost;
}

function displayName(from: string, fallback: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return m?.[1]?.trim() || fallback;
}

// Global fallbacks — a slot with no SMTP_HOST_n inherits these, then the Gmail default.
const DEFAULT_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const DEFAULT_PORT = Number(process.env.SMTP_PORT) || 465;

export function listMailboxes(): Mailbox[] {
  const boxes: Mailbox[] = [];
  const seen = new Set<string>();
  const add = (user?: string, pass?: string, from?: string, host?: string, port?: string, imapHost?: string, imapPort?: string) => {
    if (!user || !pass) return;
    const id = user.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    const f = from || `<${user}>`;
    const smtpHost = host || DEFAULT_HOST;
    boxes.push({
      id, label: `${displayName(f, user)} · ${user}`, from: f, user, pass, replyTo: user,
      host: smtpHost,
      port: Number(port) || DEFAULT_PORT,
      imapHost: imapHost || deriveImapHost(smtpHost),
      imapPort: Number(imapPort) || 993,
    });
  };
  // The primary slot keeps honouring the un-suffixed IMAP_HOST/IMAP_PORT it always did.
  add(process.env.SMTP_USER, process.env.SMTP_PASS, process.env.EMAIL_FROM, process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.IMAP_HOST, process.env.IMAP_PORT);
  for (const n of [2, 3, 4, 5]) {
    add(process.env[`SMTP_USER_${n}`], process.env[`SMTP_PASS_${n}`], process.env[`EMAIL_FROM_${n}`], process.env[`SMTP_HOST_${n}`], process.env[`SMTP_PORT_${n}`], process.env[`IMAP_HOST_${n}`], process.env[`IMAP_PORT_${n}`]);
  }
  return boxes;
}

// Resolve a stored mailbox id to its config; falls back to the primary mailbox.
export function resolveMailbox(id?: string | null): Mailbox | null {
  const boxes = listMailboxes();
  if (!boxes.length) return null;
  if (id) {
    const m = boxes.find((b) => b.id === id.toLowerCase());
    if (m) return m;
  }
  return boxes[0];
}

// Safe shape for the UI — never exposes credentials.
export function publicMailboxes(): { id: string; label: string }[] {
  return listMailboxes().map((m) => ({ id: m.id, label: m.label }));
}
