import { promises as dns } from "dns";

export type EmailVerdict = "valid" | "invalid_syntax" | "no_mx";

const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Common typo domains -> not auto-corrected, just flagged via MX (these usually fail MX anyway).

const mxCache = new Map<string, boolean>();

async function domainHasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = Array.isArray(records) && records.length > 0;
    if (!ok) {
      // Some domains accept mail on the A record (implicit MX).
      const a = await dns.resolve(domain).catch(() => []);
      ok = a.length > 0;
    }
  } catch {
    ok = false;
  }
  mxCache.set(domain, ok);
  return ok;
}

export function syntaxValid(email: string): boolean {
  return SYNTAX.test(email);
}

/**
 * Validate a batch of emails. Syntax is checked for all; MX is checked once per
 * unique domain (cached) up to `mxLimit` domains to bound latency. Returns a
 * verdict per email plus a summary.
 */
export async function verifyEmails(
  emails: string[],
  opts: { checkMx?: boolean; mxLimit?: number } = {},
): Promise<{ verdicts: Record<string, EmailVerdict>; summary: { valid: number; invalid_syntax: number; no_mx: number } }> {
  const checkMx = opts.checkMx !== false;
  const mxLimit = opts.mxLimit ?? 500;
  const verdicts: Record<string, EmailVerdict> = {};

  const uniqueDomains = new Set<string>();
  for (const e of emails) {
    if (!SYNTAX.test(e)) { verdicts[e] = "invalid_syntax"; continue; }
    uniqueDomains.add(e.split("@")[1].toLowerCase());
  }

  if (checkMx && uniqueDomains.size <= mxLimit) {
    const domains = [...uniqueDomains];
    // resolve domains with limited concurrency
    const conc = 12;
    for (let i = 0; i < domains.length; i += conc) {
      await Promise.all(domains.slice(i, i + conc).map((d) => domainHasMx(d)));
    }
  }

  for (const e of emails) {
    if (verdicts[e] === "invalid_syntax") continue;
    const domain = e.split("@")[1].toLowerCase();
    if (checkMx && uniqueDomains.size <= mxLimit) {
      verdicts[e] = mxCache.get(domain) ? "valid" : "no_mx";
    } else {
      verdicts[e] = "valid"; // syntax-only when MX skipped
    }
  }

  const summary = { valid: 0, invalid_syntax: 0, no_mx: 0 };
  for (const v of Object.values(verdicts)) summary[v]++;
  return { verdicts, summary };
}
