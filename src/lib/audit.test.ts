import { describe, expect, it } from "vitest";
import { AUDIT_TTL_DAYS, GEO_MAX, isStale, normalizeWebsite, qualifies, SEO_MAX } from "./audit";
import type { AuditRecord } from "./types";

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    website: "https://example.com", host: "example.com", status: "ok",
    seoScore: 40, geoScore: 30, geoPageScore: 35,
    seoBand: "poor", geoBand: "poor", auditId: "a1",
    reportUrl: "https://maveriko.com/audit/a1",
    topIssue: "issue", topFix: "fix", error: "",
    checkedAt: new Date().toISOString(),
    ...over,
  };
}

describe("normalizeWebsite", () => {
  it("canonicalises to https + bare host, dropping www, path, query and case", () => {
    // All four of these are the same business; if they normalise differently we
    // audit the same site four times and mail the owner four times.
    for (const raw of [
      "http://www.Example.com/contact?utm_source=maps",
      "example.com",
      "https://example.com/",
      "  HTTPS://WWW.EXAMPLE.COM/a/b#x  ",
    ]) {
      expect(normalizeWebsite(raw)).toBe("https://example.com");
    }
  });

  it("keeps real subdomains distinct — they are genuinely different sites", () => {
    expect(normalizeWebsite("shop.example.com")).toBe("https://shop.example.com");
  });

  it("rejects social and directory listings, which are never the client's own site", () => {
    // Emailing an owner about "the SEO of your site" and naming their Facebook
    // page is an instant credibility loss.
    for (const raw of [
      "https://facebook.com/somebiz",
      "https://www.instagram.com/somebiz",
      "https://m.facebook.com/somebiz",
      "https://api.whatsapp.com/send?phone=91",
      "https://somebiz.business.site",
      "https://www.justdial.com/x",
    ]) {
      expect(normalizeWebsite(raw)).toBeNull();
    }
  });

  it("rejects junk that a scraper realistically emits", () => {
    for (const raw of ["", "   ", "tel:+919876543210", "mailto:a@b.com", "not a url", "localhost", "https://", "ftp://example.com"]) {
      expect(normalizeWebsite(raw)).toBeNull();
    }
    expect(normalizeWebsite(null)).toBeNull();
    expect(normalizeWebsite(undefined)).toBeNull();
  });
});

describe("qualifies", () => {
  const opts = { maxSeo: SEO_MAX, maxGeo: GEO_MAX };

  it("requires BOTH scores under their threshold", () => {
    expect(qualifies(rec({ seoScore: 69, geoScore: 49 }), opts)).toBe(true);
    expect(qualifies(rec({ seoScore: 70, geoScore: 49 }), opts)).toBe(false); // boundary is exclusive
    expect(qualifies(rec({ seoScore: 69, geoScore: 50 }), opts)).toBe(false);
    expect(qualifies(rec({ seoScore: 94, geoScore: 12 }), opts)).toBe(false); // strong SEO, weak AI
  });

  it("never qualifies a business we failed to score", () => {
    // The email quotes a real number; no number means no email, full stop.
    expect(qualifies(rec({ status: "failed", seoScore: null, geoScore: null }), opts)).toBe(false);
    expect(qualifies(rec({ status: "ok", seoScore: null }), opts)).toBe(false);
    expect(qualifies(undefined, opts)).toBe(false);
    expect(qualifies(null, opts)).toBe(false);
  });

  it("treats zero as a real score, not as missing", () => {
    expect(qualifies(rec({ seoScore: 0, geoScore: 0 }), opts)).toBe(true);
  });
});

describe("isStale", () => {
  it("expires an audit after the TTL so no email quotes a months-old score", () => {
    const now = Date.parse("2026-08-23T00:00:00Z");
    const at = (days: number) => rec({ checkedAt: new Date(now - days * 86_400_000).toISOString() });
    expect(isStale(at(1), now)).toBe(false);
    expect(isStale(at(AUDIT_TTL_DAYS - 1), now)).toBe(false);
    expect(isStale(at(AUDIT_TTL_DAYS + 1), now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale, never as fresh", () => {
    expect(isStale(rec({ checkedAt: "not a date" }))).toBe(true);
  });
});
