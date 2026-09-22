// Reads what a PUBLIC LinkedIn profile exposes without logging in: the page title
// ("Name - Headline | LinkedIn") and og:description (headline · start of About).
// No API, no key, no Apollo credit.
//
// LinkedIn frequently refuses cloud servers (HTTP 999) and private profiles expose
// nothing, so a blocked read is normal, not an error: we fall back to a name guessed
// from the URL slug and let the user type the rest.

import type { Person } from "./types";
import { decodeEntities, metaContent } from "./html";

const PROFILE_RE = /^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/([^/?#]+)\/?/i;
const HONORIFICS = /^(dr|mr|mrs|ms|miss|prof|professor|ca|cs|adv|er|shri|smt|sri)\.?\s+/i;

export function normalizeLinkedInUrl(raw: string): string | null {
  const s = (raw || "").trim();
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const m = withScheme.match(PROFILE_RE);
  if (!m) return null;
  return `https://www.linkedin.com/in/${m[1]}/`;
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => a.toUpperCase() + b);
}

/** "Dr. Asha Rao, CFA" → { name: "Asha Rao", firstName: "Asha" } */
export function splitName(raw: string): { name: string; firstName: string } {
  // Split off post-nominals ("…, CFA") BEFORE stripping punctuation, or the comma is gone.
  let n = decodeEntities(raw || "").split(",")[0];
  n = n.replace(/[^\p{L}\p{M}\s.'’-]/gu, " ").replace(/\s+/g, " ").trim();
  while (HONORIFICS.test(n)) n = n.replace(HONORIFICS, "");
  if (n && n === n.toLowerCase()) n = titleCase(n);
  const firstName = n.split(" ")[0] || "";
  return { name: n, firstName: firstName.length >= 2 ? firstName : "" };
}

/**
 * Name from the profile URL slug, e.g. "asha-rao-4b1a2c3" → "Asha Rao". Only trusted
 * when it yields at least two alphabetic parts: "williamhgates" would give a wrong name.
 */
export function nameFromSlug(url: string): { name: string; firstName: string } {
  const m = (url || "").match(PROFILE_RE);
  if (!m) return { name: "", firstName: "" };
  const parts = decodeURIComponent(m[1]).split(/[-_]/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.length < 2) return { name: "", firstName: "" };
  return splitName(parts.slice(0, 3).join(" "));
}

/** Parse a fetched profile page. `null` when it isn't a readable public profile. */
export function parseProfileHtml(html: string): Omit<Person, never> | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities(titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  // A real profile title ends "| LinkedIn" and starts with a name; the authwall and
  // sign-up pages have titles like "Sign Up | LinkedIn" or "LinkedIn".
  const t = title.match(/^(.+?)\s+[-–]\s+(.+?)\s*\|\s*LinkedIn$/i) || title.match(/^(.+?)\s*\|\s*LinkedIn$/i);
  // Login/sign-up/authwall pages also end "| LinkedIn" — never read those as a person.
  if (!t || /\blinked ?in\b|^(sign ?up|sign ?in|log ?in|join)\b/i.test(t[1].trim())) return null;

  const { name, firstName } = splitName(t[1]);
  if (!name) return null;
  let headline = (t[2] || "").trim();

  const og = decodeEntities(metaContent(html, "og:description") || metaContent(html, "description") || "");
  let about = "";
  let companyHint = "";
  if (og) {
    const segs = og.split(/\s+·\s+/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segs) {
      const exp = seg.match(/^Experience:\s*(.+)$/i);
      if (exp) { companyHint = exp[1].trim(); continue; }
      if (/^(Education|Location):/i.test(seg) || /connections on LinkedIn/i.test(seg)) continue;
      if (!headline) { headline = seg; continue; }
      if (seg !== headline && !about) about = seg;
    }
  }
  return {
    name,
    firstName,
    headline: headline.slice(0, 220),
    about: about.slice(0, 400),
    companyHint: companyHint.slice(0, 120),
  };
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function readLinkedIn(rawUrl: string): Promise<{ person: Person; blocked: boolean; note: string }> {
  const empty: Person = { name: "", firstName: "", headline: "", about: "", companyHint: "" };
  const url = normalizeLinkedInUrl(rawUrl);
  if (!url) return { person: empty, blocked: true, note: "That doesn't look like a LinkedIn profile link (linkedin.com/in/…)." };

  const fallback = (note: string) => {
    const guess = nameFromSlug(url);
    return {
      person: { ...empty, ...guess },
      blocked: true,
      note: guess.name ? `${note} Name guessed from the link — check it, and paste their headline.` : `${note} Type their name and headline below.`,
    };
  };

  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback(`LinkedIn didn't share this profile (HTTP ${res.status}).`);
    if (/\/(authwall|login|signup)/i.test(res.url)) return fallback("LinkedIn asked for a login to see this profile.");
    const html = (await res.text()).slice(0, 1_500_000);
    const person = parseProfileHtml(html);
    if (!person) return fallback("This profile isn't public, or LinkedIn hid it.");
    return { person, blocked: false, note: "" };
  } catch (e) {
    return fallback(`Couldn't reach LinkedIn (${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}).`);
  }
}
