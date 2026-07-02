// Configurable sending mailboxes. The primary mailbox comes from SMTP_USER /
// SMTP_PASS / EMAIL_FROM; additional mailboxes are numbered slots
// SMTP_USER_2..5 / SMTP_PASS_2..5 / EMAIL_FROM_2..5 — each a Gmail sender with its
// own App Password. Campaigns store a `fromMailbox` (the address) to pick one.

export type Mailbox = {
  id: string; // the lowercased Gmail address — stable id stored on campaigns
  label: string; // display string for the dropdown
  from: string; // EMAIL_FROM value, e.g. `Brand Vibe <brandvibe2k26@gmail.com>`
  user: string; // SMTP username
  pass: string; // SMTP App Password
  replyTo: string; // where replies land (the mailbox's own address)
};

function displayName(from: string, fallback: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return m?.[1]?.trim() || fallback;
}

export function listMailboxes(): Mailbox[] {
  const boxes: Mailbox[] = [];
  const seen = new Set<string>();
  const add = (user?: string, pass?: string, from?: string) => {
    if (!user || !pass) return;
    const id = user.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    const f = from || `<${user}>`;
    boxes.push({ id, label: `${displayName(f, user)} · ${user}`, from: f, user, pass, replyTo: user });
  };
  add(process.env.SMTP_USER, process.env.SMTP_PASS, process.env.EMAIL_FROM);
  for (const n of [2, 3, 4, 5]) {
    add(process.env[`SMTP_USER_${n}`], process.env[`SMTP_PASS_${n}`], process.env[`EMAIL_FROM_${n}`]);
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
