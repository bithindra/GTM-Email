// Client for Maveriko's machine audit endpoint. This is the middle of the
// outreach machine: businesses come in from the Maps scraper, their websites go
// out to maveriko.com, and scores come back to decide who is worth emailing.
//
// The public POST /api/audit meters every caller through a per-IP daily bucket
// (~10/day), so batching goes through POST /api/machine/audit instead — same
// engine, quota-exempt, gated by a shared secret.

import type { AuditRecord } from "./types";

export type { AuditRecord };

/** Thresholds the outreach filter defaults to. Both editable in the UI. */
export const SEO_MAX = 70;
export const GEO_MAX = 50;

/** A cached audit older than this is re-run — sites change, and a stale score in
 *  a cold email is worse than no email. */
export const AUDIT_TTL_DAYS = 30;

/** Batch size the machine endpoint accepts (8 x 25s fits its 240s budget). */
const CHUNK = 8;

// Hosts that are never the business's own site. Emailing someone about the SEO
// of their Facebook page is an instant credibility loss.
const NOT_A_SITE = new Set([
  "facebook.com", "m.facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "youtube.com", "wa.me", "api.whatsapp.com", "whatsapp.com",
  "google.com", "business.site", "sites.google.com", "maps.google.com",
  "justdial.com", "indiamart.com", "zomato.com", "swiggy.com", "yelp.com",
  "tripadvisor.com", "practo.com", "linktr.ee",
]);

/**
 * Canonical form of a business website: "https://host", no www, no path.
 * This is both the dedupe key and the cache key, so it has to be stable.
 * Returns null for anything that is not a real, auditable site of their own.
 */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (/^(tel:|mailto:)/i.test(trimmed)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // Reject bare hostnames with no dot ("localhost") and obvious non-domains.
  if (!host.includes(".") || host.endsWith(".")) return null;
  if (NOT_A_SITE.has(host)) return null;
  // A subdomain of a directory is still a directory listing, not their site.
  const parent = host.split(".").slice(-2).join(".");
  if (NOT_A_SITE.has(parent) && host !== parent) return null;
  return `https://${host}`;
}

export function hostOf(website: string): string {
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
}

/** Does this audit qualify the business for outreach? */
export function qualifies(a: AuditRecord | undefined | null, opts: { maxSeo: number; maxGeo: number }): boolean {
  if (!a || a.status !== "ok") return false;
  if (a.seoScore === null || a.geoScore === null) return false;
  return a.seoScore < opts.maxSeo && a.geoScore < opts.maxGeo;
}

export function isStale(a: AuditRecord, now = Date.now()): boolean {
  const t = Date.parse(a.checkedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > AUDIT_TTL_DAYS * 86_400_000;
}

type MachineRow = {
  url: string; ok: boolean; id?: string; reportUrl?: string; finalUrl?: string;
  seoScore?: number; geoScore?: number; geoPageScore?: number;
  seoBand?: string; geoBand?: string; topIssue?: string; topFix?: string; error?: string;
};

function maverikoUrl(): string {
  return (process.env.MAVERIKO_URL || "https://maveriko.com").replace(/\/$/, "");
}

function failed(website: string, error: string): AuditRecord {
  return {
    website, host: hostOf(website), status: "failed",
    seoScore: null, geoScore: null, geoPageScore: null,
    seoBand: "", geoBand: "", auditId: "", reportUrl: "",
    topIssue: "", topFix: "", error, checkedAt: new Date().toISOString(),
  };
}

function toRecord(website: string, r: MachineRow): AuditRecord {
  if (!r.ok || typeof r.seoScore !== "number" || typeof r.geoScore !== "number") {
    return failed(website, r.error || "FAILED");
  }
  // A report link that is not a public https URL must never reach an email —
  // a misconfigured NEXT_PUBLIC_SITE_URL on the audit side would otherwise mail
  // strangers a localhost link. Treat it as an unusable audit.
  const report = r.reportUrl ?? "";
  if (!/^https:\/\//i.test(report)) return failed(website, "BAD_REPORT_URL");
  return {
    website, host: hostOf(website), status: "ok",
    seoScore: r.seoScore, geoScore: r.geoScore,
    geoPageScore: typeof r.geoPageScore === "number" ? r.geoPageScore : null,
    seoBand: r.seoBand ?? "", geoBand: r.geoBand ?? "",
    auditId: r.id ?? "", reportUrl: report,
    topIssue: r.topIssue ?? "", topFix: r.topFix ?? "",
    error: "", checkedAt: new Date().toISOString(),
  };
}

async function auditChunk(websites: string[]): Promise<AuditRecord[]> {
  const token = process.env.MACHINE_AUDIT_TOKEN;
  if (!token) return websites.map((w) => failed(w, "NO_TOKEN"));

  const call = async (): Promise<AuditRecord[]> => {
    const res = await fetch(`${maverikoUrl()}/api/machine/audit`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-machine-token": token },
      body: JSON.stringify({ urls: websites }),
      signal: AbortSignal.timeout(280_000),
    });
    if (!res.ok) {
      const err = `HTTP_${res.status}`;
      // 4xx is our fault (bad token, bad body) — retrying cannot help.
      if (res.status < 500) return websites.map((w) => failed(w, err));
      throw new Error(err);
    }
    const data = (await res.json()) as { results?: MachineRow[] };
    const byUrl = new Map((data.results ?? []).map((r) => [r.url, r]));
    return websites.map((w) => {
      const r = byUrl.get(w);
      return r ? toRecord(w, r) : failed(w, "NO_RESULT");
    });
  };

  try {
    return await call();
  } catch {
    // One retry: the batch is long-running and a single network blip should not
    // cost 8 leads. A second failure is recorded as data, not thrown.
    try {
      return await call();
    } catch (e) {
      return websites.map((w) => failed(w, (e as Error).message?.slice(0, 100) || "NETWORK"));
    }
  }
}

/** Audit every website, in chunks. Never throws — failures come back as rows. */
export async function auditBatch(websites: string[]): Promise<AuditRecord[]> {
  const out: AuditRecord[] = [];
  for (let i = 0; i < websites.length; i += CHUNK) {
    out.push(...(await auditChunk(websites.slice(i, i + CHUNK))));
  }
  return out;
}
