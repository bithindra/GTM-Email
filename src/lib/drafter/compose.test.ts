import { describe, expect, it } from "vitest";
import { ANGLES, cleanTitle, compose, detectRole, employerFrom, sameCompany, toTemplate } from "./compose";
import { BANNED } from "./offerings";
import type { Company, DraftAudit, Offering, Person } from "./types";

const P = (over: Partial<Person> = {}): Person => ({ name: "Asha Rao", firstName: "Asha", headline: "Founder & CEO at Acme Dental | Speaker", about: "", companyHint: "", ...over });
const C = (over: Partial<Company> = {}): Company => ({ name: "Acme Dental", website: "https://acmedental.in", host: "acmedental.in", tagline: "Painless dental care for busy Pune families.", hasBlog: false, ...over });
const AUDIT: DraftAudit = { seoScore: 62, geoScore: 31, topFix: "Add a clear one-sentence answer at the top of each service page.", topIssue: "No direct answers", reportUrl: "https://maveriko.com/audit/abc123" };
const EMPTY_P: Person = { name: "", firstName: "", headline: "", about: "", companyHint: "" };
const EMPTY_C: Company = { name: "", website: "", host: "", tagline: "", hasBlog: false };

const OFFERINGS: Offering[] = ["brandvibe", "maveriko", "xambaaz"];
const DATA_CASES: [string, Person, Company, DraftAudit | null][] = [
  ["everything known", P(), C(), AUDIT],
  ["nothing known", EMPTY_P, EMPTY_C, null],
  ["name only", P({ headline: "" }), EMPTY_C, null],
  ["site only", EMPTY_P, C(), null],
  ["audit failed", P(), C(), { ...AUDIT, seoScore: null, geoScore: null }],
];

describe("compose — never ships a broken or false email", () => {
  for (const offering of OFFERINGS) {
    for (const angle of ANGLES[offering]) {
      for (const [label, person, company, audit] of DATA_CASES) {
        it(`${offering}/${angle.id} — ${label}`, () => {
          const d = compose({ offering, angle: angle.id, person, company, audit });
          const text = `${d.subject}\n${d.body}`;
          expect(d.subject.trim().length).toBeGreaterThan(10);
          for (const bad of BANNED) {
            const re = /^\w+$/.test(bad) ? new RegExp(`\\b${bad}\\b`, "i") : new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            expect(text, `banned "${bad}"`).not.toMatch(re);
          }
          // No empty paragraphs, no dangling "at ." / "for ." from a missing value.
          expect(d.body).not.toMatch(/\n\n\s*\n\n/);
          expect(text).not.toMatch(/\b(at|for|on|to)\s+[.,—]/);
          expect(text).not.toMatch(/“”|""/);
          // Every chip describes something actually in the email.
          for (const u of d.used) {
            const value = u.split(": ").slice(1).join(": ");
            if (value && !u.startsWith("Audit") && !u.startsWith("Homepage")) expect(text).toContain(value);
          }
        });
      }
    }
  }
});

describe("compose — personalisation comes only from real data", () => {
  it("uses their name, role, company and homepage line when known", () => {
    const d = compose({ offering: "brandvibe", angle: "roi", person: P(), company: C(), audit: null });
    expect(d.body).toMatch(/^Hi Asha,/);
    expect(d.body).toContain("As Founder & CEO at Acme Dental");
    expect(d.body).toContain("“Painless dental care for busy Pune families”");
    expect(d.used).toEqual(expect.arrayContaining(["First name: Asha", "Role: Founder & CEO", "Company: Acme Dental"]));
  });
  it("drops the role sentence rather than guessing when the headline is missing", () => {
    const d = compose({ offering: "brandvibe", angle: "roi", person: P({ headline: "" }), company: C(), audit: null });
    expect(d.body).not.toContain("As ");
  });
  it("greets generically and warns when the name is unknown", () => {
    const d = compose({ offering: "brandvibe", person: EMPTY_P, company: EMPTY_C, audit: null });
    expect(d.body).toMatch(/^Hi there,/);
    expect(d.warnings.join(" ")).toMatch(/No first name/);
  });
  it("XamBaaz greets a principal formally, and warns when it isn't a school leader", () => {
    expect(compose({ offering: "xambaaz", person: EMPTY_P, company: EMPTY_C, audit: null }).body).toMatch(/^Dear Principal,/);
    const d = compose({ offering: "xambaaz", person: P(), company: C(), audit: null });
    expect(d.warnings.join(" ")).toMatch(/school leader/);
  });
  it("Maveriko quotes their real scores, fix and report when audited", () => {
    const d = compose({ offering: "maveriko", person: P(), company: C(), audit: AUDIT });
    expect(d.subject).toBe("acmedental.in scored 62/100 on search visibility");
    expect(d.body).toContain("62/100 for search visibility and 31/100 for AI readiness");
    expect(d.body).toContain(AUDIT.topFix);
    expect(d.body).toContain(AUDIT.reportUrl);
  });
  it("Maveriko without scores offers the free check and says why", () => {
    const d = compose({ offering: "maveriko", person: P(), company: C(), audit: null });
    expect(d.body).toContain("https://maveriko.com");
    expect(d.body).not.toMatch(/\/100/);
    expect(d.warnings.join(" ")).toMatch(/No audit scores/);
  });
  it("XamBaaz quotes the live content figures, not the stale ones", () => {
    const d = compose({ offering: "xambaaz", angle: "pilot", person: EMPTY_P, company: EMPTY_C, audit: null });
    expect(d.body).toContain("30,000+ questions across 410+ chapters");
    expect(d.body).not.toMatch(/18,000|315 chapters/);
  });
});

describe("detectRole", () => {
  const role = (headline: string, company: Partial<Company> = {}) => detectRole({ headline, about: "" }, { name: company.name ?? "", tagline: company.tagline ?? "" });
  it.each([
    ["Founder & CEO at Acme", "owner"],
    ["Managing Director, Kulkarni Industries", "owner"],
    ["Chief Operating Officer at Acme", "cxo"],
    ["VP Marketing | Growth", "cxo"],
    ["CHRO at Acme Bank", "hr"],
    ["Head of Learning & Development", "hr"],
    ["Software Engineer", "other"],
  ])("%s → %s", (h, want) => expect(role(h)).toBe(want));
  it("'Principal' is a school leader only with school context", () => {
    expect(role("Principal Engineer at Google")).toBe("other");
    expect(role("Principal at Delhi Public School")).toBe("principal");
    expect(role("Principal", { name: "Silver Oaks International School" })).toBe("principal");
  });
  it("spots agencies for the Maveriko agency angle", () => {
    expect(role("Founder at PixelCraft", { tagline: "A digital marketing agency for D2C brands" })).toBe("agency");
  });
});

describe("cleanTitle", () => {
  it.each([
    ["Founder & CEO at Acme | Speaker | Author", "Founder & CEO"],
    ["Chief Growth Officer @ Acme", "Chief Growth Officer"],
    ["Helping founders scale · Growth Consultant", "Growth Consultant"],
    ["Helping founders scale at speed", ""],
    ["Passionate about people | Head of Talent at Acme", "Head of Talent"],
    ["", ""],
  ])("%s → %s", (h, want) => expect(cleanTitle(h)).toBe(want));
  it("rejects titles too long to read naturally in a sentence", () => {
    expect(cleanTitle("I help mid-market manufacturing companies in western India unlock growth with data")).toBe("");
  });
});

describe("toTemplate", () => {
  it("turns their name and company back into merge fields", () => {
    const out = toTemplate("Hi Asha,\n\nAs CEO at Acme Dental, Asha…", { firstName: "Asha" }, "Acme Dental");
    expect(out).toBe("Hi {{first_name}},\n\nAs CEO at {{company}}, {{first_name}}…");
  });
  it("does not replace inside other words", () => {
    expect(toTemplate("Ashanti met Asha", { firstName: "Asha" }, "")).toBe("Ashanti met {{first_name}}");
  });
});

describe("never asserts a job they don't hold", () => {
  it("uses the employer from their own headline, not the website, in the role sentence", () => {
    // Real mismatch found in testing: Satya Nadella's LinkedIn + zerodha.com.
    const d = compose({
      offering: "brandvibe", angle: "roi",
      person: P({ name: "Satya Nadella", firstName: "Satya", headline: "Chairman and CEO at Microsoft" }),
      company: C({ name: "Zerodha", host: "zerodha.com", website: "https://zerodha.com", tagline: "Online stock brokerage platform." }),
      audit: null,
    });
    expect(d.body).toContain("As Chairman and CEO at Microsoft");
    expect(d.body).not.toContain("CEO at Zerodha");
    expect(d.warnings.join(" ")).toMatch(/LinkedIn says they work at Microsoft, but the website is Zerodha/);
  });
  it("no warning when LinkedIn and the website agree", () => {
    const d = compose({ offering: "brandvibe", person: P(), company: C(), audit: null });
    expect(d.warnings.join(" ")).not.toMatch(/LinkedIn says/);
  });
  it.each([
    ["Founder at Acme Dental | Speaker", "Acme Dental"],
    ["CEO @ Acme", "Acme"],
    ["Chief Growth Officer", ""],
    ["Helping founders scale at speed", ""],
    ["Passionate about people | Head of Talent at Acme Bank", "Acme Bank"],
  ])("employerFrom(%s) → %s", (h, want) => expect(employerFrom(h)).toBe(want));
  it("matches company names loosely", () => {
    expect(sameCompany("Acme Dental Pvt Ltd", "Acme Dental")).toBe(true);
    expect(sameCompany("Microsoft", "Zerodha")).toBe(false);
  });
});
