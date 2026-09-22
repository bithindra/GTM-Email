// Pure, client-safe helpers for picking a sending mailbox. Kept apart from
// mailboxes.ts, which reads SMTP credentials from the environment and must stay
// server-only — these run in the browser (campaign form, email drafter) as well.

// Pick the sending mailbox that belongs to a mail's brand, so a XamBaaz mail goes out
// from a xambaaz address and a Brand Vibe mail from a brandvibe one. Matches the
// category against the address ("XamBaaz" -> partnerships@xambaaz.com), and prefers a
// custom-domain mailbox over a free consumer one when both match — the domain sender is
// authenticated (SPF/DKIM/DMARC) and is what we want used by default.
export const CONSUMER_MAIL = /@(gmail|googlemail|outlook|hotmail|yahoo|live|aol)\./i;

export function mailboxForCategory(category: string | null | undefined, mailboxes: { id: string }[]): string | null {
  const key = (category || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  const matches = mailboxes.filter((m) => m.id.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key));
  if (!matches.length) return null;
  return (matches.find((m) => !CONSUMER_MAIL.test(m.id)) ?? matches[0]).id;
}

// First category that matches a mailbox wins. Maveriko has no mailbox of its own —
// it is a Brand Vibe product, so it sends from the Brand Vibe address.
export function mailboxForCategories(categories: string[], mailboxes: { id: string }[]): string | null {
  for (const c of categories) {
    const hit = mailboxForCategory(c, mailboxes);
    if (hit) return hit;
  }
  return null;
}
