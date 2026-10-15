import { describe, expect, it } from "vitest";
import { hasUnresolvedMerge, mergeDataFromProspect, renderTemplate, spin } from "./email";
import { TEMPLATE_LIBRARY } from "./templateLibrary";
import { ALL_BUSINESS_TYPES, mapsQuery } from "./business-types";
import { BANNED } from "./drafter/offerings";
import type { AuditRecord } from "./types";

const AUDIT: AuditRecord = {
  website: "https://smiledental.in", host: "smiledental.in", status: "ok",
  seoScore: 54, geoScore: 22, geoPageScore: null, seoBand: "needs-work", geoBand: "poor",
  auditId: "a1", reportUrl: "https://maveriko.com/audit/a1", topIssue: "No meta description",
  topFix: "Add a one-sentence description of what you do to the top of your homepage.", error: "",
  checkedAt: new Date().toISOString(),
};
// Exactly how the import stores a Maps lead: no person's name, the business as company.
const LEAD = { name: "", company: "Smile Dental", title: "", city: "Pune", country: "" };
const V2 = ["audit-outreach-growth-v2", "audit-outreach-followup-v2"].map((k) => TEMPLATE_LIBRARY.find((t) => t.key === k)!);

describe("Audit Outreach v2 mails", () => {
  for (const t of V2) {
    it(`${t.key} renders in full for a scored business`, () => {
      const data = mergeDataFromProspect(LEAD, AUDIT);
      const subject = renderTemplate(spin(t.subject, "r1"), data);
      const body = renderTemplate(spin(t.body, "r1"), data);
      expect(hasUnresolvedMerge(t.subject, subject, data)).toBeNull();
      expect(hasUnresolvedMerge(t.body, body, data)).toBeNull();
      expect(body).toMatch(/^Hi there,/); // info@ inboxes have no name
      if (t.key === "audit-outreach-growth-v2") expect(body).toContain("54/100");
      expect(body).toContain(AUDIT.reportUrl);
      for (const bad of BANNED.filter((b) => !b.includes("{") && !b.includes("}"))) {
        expect(`${subject}\n${body}`.toLowerCase()).not.toContain(bad);
      }
    });
    it(`${t.key} is refused for a business without a usable audit`, () => {
      const data = mergeDataFromProspect(LEAD, null);
      expect(hasUnresolvedMerge(t.body, renderTemplate(t.body, data), data)).toMatch(/no audit data/);
    });
  }
  it("asks one question, offers the done-for-you route, and is a personal note", () => {
    expect(V2[0].body).toMatch(/3-step plan for \{\{website\}\}\?/);
    expect(V2.every((t) => t.format === "plain" && t.track === false)).toBe(true);
    expect(V2[0].body).toMatch(/Brand Vibe/);
    expect(V2[0].body.split(/\s+/).length).toBeLessThan(190);
  });
});

describe("business types", () => {
  it("have unique ids and readable Maps keywords", () => {
    const ids = ALL_BUSINESS_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_BUSINESS_TYPES.length).toBeGreaterThan(100);
  });
  it("build the Maps query from type, area and city", () => {
    expect(mapsQuery("dental clinics", "Pune", "Koregaon Park")).toBe("dental clinics in Koregaon Park, Pune");
    expect(mapsQuery("cafes", " Goa ")).toBe("cafes in Goa");
  });
});

// The live mails rewritten as personal notes on 15 Oct 2026 (posted to the live app).
import LIVE from "../../scripts/personal-templates-2026-10-15.json";
describe("personal-note rewrites of the live mails", () => {
  for (const t of LIVE as { name: string; subject: string; body: string }[]) {
    it(`${t.name} reads as a short personal note`, () => {
      const data = mergeDataFromProspect({ name: "Asha Rao", company: "Acme Dental", title: "", city: "Pune", country: "" }, AUDIT);
      const subject = renderTemplate(t.subject, data), body = renderTemplate(t.body, data);
      expect(hasUnresolvedMerge(t.subject, subject, data)).toBeNull();
      expect(hasUnresolvedMerge(t.body, body, data)).toBeNull();
      expect(body.split(/\s+/).length).toBeLessThan(170);
      expect((body.match(/https?:\/\//g) ?? []).length).toBeLessThanOrEqual(1); // one link at most
      expect(body).toMatch(/reply "stop"/);
      expect(body).toMatch(/\n(Bithin|Warm regards,\nBithin)\n/);
      for (const bad of ["cited by", "ai visibility", "nmims", "sr vp", "radio mirchi"]) expect(`${subject}\n${body}`.toLowerCase()).not.toContain(bad);
    });
  }
});
