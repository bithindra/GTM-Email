// Reads a company's own homepage for the facts a personal email can honestly use:
// its name and its one-line description, quoted back — never paraphrased or invented.
//
// SSRF guard: this app has no login, so the endpoint that calls this is public. It must
// never become a way to make our server fetch internal addresses. Only http(s) on
// 80/443, every hop's host resolved and refused if private/loopback/link-local, a small
// redirect budget re-checked per hop, and hard size and time caps. (A DNS answer that
// changes between our check and the fetch is a residual risk we accept for a page read.)

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeWebsite, hostOf } from "../audit";
import { decodeEntities, metaContent, textOf } from "./html";
import type { Company } from "./types";

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s); // unique-local, link-local
  }
  return true; // not an IP at all: refuse
}

/** Throws unless the URL is a public http(s) address on a standard port. */
export async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) websites can be read.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Only standard web ports can be read.");
  if (u.username || u.password) throw new Error("URLs with credentials can't be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("That address isn't a public website.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("That address isn't a public website.");
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES));
}

/** Fetch a page, validating every redirect hop against the SSRF rules. */
export async function fetchPublicHtml(start: string): Promise<{ html: string; finalUrl: string }> {
  let url = new URL(start);
  const deadline = AbortSignal.timeout(8000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
      redirect: "manual",
      signal: deadline,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`The site redirected without a destination (HTTP ${res.status}).`);
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`The site answered HTTP ${res.status}.`);
    const type = res.headers.get("content-type") || "";
    if (type && !/html|xml/i.test(type)) throw new Error("That address isn't a web page.");
    return { html: await readCapped(res), finalUrl: url.toString() };
  }
  throw new Error("The site redirected too many times.");
}

// Bot walls, error pages and boilerplate — never quote these back to a prospect.
const JUNK = /\b(just a moment|attention required|access denied|forbidden|enable javascript|checking your browser|cloudflare|captcha|page not found|404|coming soon|under construction|index of|default web site|welcome to nginx|it works)\b/i;
const GENERIC = /^(home|homepage|welcome|welcome to .{0,40}|official website|official site)$/i;

function clean(s: string): string {
  return decodeEntities(s || "").replace(/\s+/g, " ").trim();
}

/** Company name: og:site_name, else the most name-like part of the <title>. */
export function companyNameFrom(html: string, host: string): string {
  const site = clean(metaContent(html, "og:site_name"));
  if (site && site.length <= 60 && !JUNK.test(site)) return site;
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  // Separators seen in the wild: "A | B", "A – B", "A - B", and "A: B" (no space before
  // the colon, e.g. "Zerodha: Online brokerage…").
  const parts = title.split(/\s*[|–—]\s*|\s+-\s+|:\s+/).map((p) => p.trim()).filter((p) => p && !GENERIC.test(p) && !JUNK.test(p));
  // Prefer the part that shares a word with the domain ("Acme Dental" on acmedental.in).
  const label = host.replace(/^www\./, "").split(".")[0].toLowerCase();
  const byHost = parts.find((p) => p.toLowerCase().split(/\s+/).some((w) => w.length > 2 && label.includes(w.replace(/[^a-z0-9]/g, ""))));
  const pick = byHost || parts.find((p) => p.length <= 40) || "";
  return pick.length <= 60 ? pick : "";
}

/** Their own one-line description, safe to quote: first sentence, ≤ 180 chars, never junk. */
export function taglineFrom(html: string, companyName: string): string {
  const h1 = textOf(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const candidates = [metaContent(html, "og:description"), metaContent(html, "description"), metaContent(html, "twitter:description"), h1];
  for (const raw of candidates) {
    let t = clean(raw);
    if (!t || t.length < 20 || JUNK.test(t) || GENERIC.test(t)) continue;
    if (companyName && t.toLowerCase() === companyName.toLowerCase()) continue;
    const firstSentence = t.match(/^.{20,180}?[.!?](?=\s|$)/)?.[0];
    if (firstSentence) t = firstSentence;
    if (t.length > 180) {
      const cut = t.slice(0, 180);
      t = `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "")}…`;
    }
    return t;
  }
  return "";
}

export async function readWebsite(raw: string): Promise<{ company: Company; note: string }> {
  const website = normalizeWebsite(raw) || "";
  const empty: Company = { name: "", website, host: website ? hostOf(website) : "", tagline: "", hasBlog: false };
  if (!website) return { company: empty, note: raw.trim() ? "That doesn't look like a company website." : "" };
  try {
    const { html } = await fetchPublicHtml(website);
    const host = hostOf(website);
    const name = companyNameFrom(html, host);
    const tagline = taglineFrom(html, name);
    const hasBlog = /href=["'][^"']*\/(blog|insights|articles|news|resources)(?:[/"'?#])/i.test(html);
    const note = tagline ? "" : "Read the site, but found no one-line description worth quoting.";
    return { company: { name, website, host, tagline, hasBlog }, note };
  } catch (e) {
    return { company: empty, note: `Couldn't read the website: ${(e as Error).message}` };
  }
}
