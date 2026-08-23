import { describe, expect, it } from "vitest";
import { hasUnresolvedMerge, mergeDataFromProspect, renderTemplate } from "./email";
import type { AuditRecord } from "./types";

const P = { name: "Sofia Garcia", company: "Nova Labs", title: "Founder", city: "Pune", country: "India" };

const AUDIT: AuditRecord = {
  website: "https://novalabs.com", host: "novalabs.com", status: "ok",
  seoScore: 48, geoScore: 31, geoPageScore: 36,
  seoBand: "poor", geoBand: "needs-work", auditId: "a1",
  reportUrl: "https://maveriko.com/audit/a1",
  topIssue: "No Organization schema", topFix: "Add an Organization schema block.",
  error: "", checkedAt: new Date().toISOString(),
};

const AUDIT_BODY = "Hi {{first_name}}, {{website}} scored {{seo_score}}/100 and {{geo_score}}/100. Fix: {{top_fix}} Report: {{report_url}}";

describe("mergeDataFromProspect", () => {
  it("fills audit fields from a successful audit", () => {
    const d = mergeDataFromProspect(P, AUDIT);
    expect(d.website).toBe("novalabs.com");
    expect(d.seo_score).toBe("48");
    expect(d.geo_score).toBe("31");
    expect(d.report_url).toBe("https://maveriko.com/audit/a1");
    expect(d.geo_band).toBe("needs work"); // slug is humanised for prose
  });

  it("leaves audit fields EMPTY rather than guessing when there is no audit", () => {
    // Empty is not a fallback: it is the signal hasUnresolvedMerge refuses on.
    for (const a of [undefined, null, { ...AUDIT, status: "failed" as const }, { ...AUDIT, seoScore: null }]) {
      const d = mergeDataFromProspect(P, a);
      expect(d.website).toBe("");
      expect(d.seo_score).toBe("");
      expect(d.report_url).toBe("");
    }
  });

  it("still fills the ordinary fields, so non-audit templates are unaffected", () => {
    const d = mergeDataFromProspect(P);
    expect(d.first_name).toBe("Sofia");
    expect(d.company).toBe("Nova Labs");
  });

  it("falls back to 'there' for the nameless generic inboxes Maps yields", () => {
    const d = mergeDataFromProspect({ name: "", company: "", title: "", city: "", country: "" }, AUDIT);
    expect(d.first_name).toBe("there");
    expect(d.company).toBe("your company");
  });

  it("renders score 0 as \"0\", not as missing", () => {
    const d = mergeDataFromProspect(P, { ...AUDIT, seoScore: 0, geoScore: 0 });
    expect(d.seo_score).toBe("0");
    expect(hasUnresolvedMerge(AUDIT_BODY, renderTemplate(AUDIT_BODY, d), d)).toBeNull();
  });
});

describe("hasUnresolvedMerge", () => {
  it("passes a fully-resolved audit mail", () => {
    const d = mergeDataFromProspect(P, AUDIT);
    const rendered = renderTemplate(AUDIT_BODY, d);
    expect(rendered).toContain("48/100");
    expect(hasUnresolvedMerge(AUDIT_BODY, rendered, d)).toBeNull();
  });

  it("BLOCKS an audit mail whose recipient has no audit", () => {
    // Without this the recipient receives "scored /100" — worse than no email,
    // and unrecoverable once delivered.
    const d = mergeDataFromProspect(P, null);
    const reason = hasUnresolvedMerge(AUDIT_BODY, renderTemplate(AUDIT_BODY, d), d);
    expect(reason).toMatch(/no audit data/);
  });

  it("BLOCKS a template referencing a merge field that does not exist", () => {
    const src = "Hi {{first_name}}, about {{revenue_last_year}}.";
    const d = mergeDataFromProspect(P, AUDIT);
    expect(hasUnresolvedMerge(src, renderTemplate(src, d), d)).toMatch(/unknown merge field/);
  });

  it("does not block an ordinary template that never asks for audit fields", () => {
    // The three existing campaigns must keep sending exactly as before.
    const src = "Hi {{first_name}}, a quick note about {{company}} in {{city}}.";
    const d = mergeDataFromProspect(P); // no audit at all
    expect(hasUnresolvedMerge(src, renderTemplate(src, d), d)).toBeNull();
  });

  it("blocks even when only ONE audit field is missing", () => {
    const d = mergeDataFromProspect(P, { ...AUDIT, topFix: "" });
    expect(hasUnresolvedMerge(AUDIT_BODY, renderTemplate(AUDIT_BODY, d), d)).toMatch(/top_fix/);
  });

  it("tolerates whitespace inside the braces, the way renderTemplate does", () => {
    const src = "Score: {{ seo_score }}";
    const d = mergeDataFromProspect(P, AUDIT);
    expect(renderTemplate(src, d)).toBe("Score: 48");
    expect(hasUnresolvedMerge(src, renderTemplate(src, d), d)).toBeNull();
    const empty = mergeDataFromProspect(P, null);
    expect(hasUnresolvedMerge(src, renderTemplate(src, empty), empty)).toMatch(/seo_score/);
  });
});
