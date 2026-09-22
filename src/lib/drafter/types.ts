// Shapes shared by the drafter's server research and its in-browser composer.
// No server imports here — this file is bundled into the page.

export type Offering = "brandvibe" | "maveriko" | "xambaaz";

/** What we know about the person. Every field may be blank: LinkedIn often blocks. */
export type Person = {
  name: string;
  firstName: string;
  headline: string; // e.g. "Founder & CEO at Acme | Speaker"
  about: string; // start of their About section, when public
  companyHint: string; // current employer named on LinkedIn, if shown
};

/** What we know about the company, read from its own website. */
export type Company = {
  name: string;
  website: string; // canonical https://host, or "" when unknown
  host: string;
  tagline: string; // their own one-line description, quoted back — never invented
  hasBlog: boolean;
};

/** The subset of a Maveriko audit the email quotes. */
export type DraftAudit = {
  seoScore: number | null;
  geoScore: number | null;
  topFix: string;
  topIssue: string;
  reportUrl: string;
};

export type Role = "owner" | "cxo" | "hr" | "principal" | "agency" | "other";

export type Draft = {
  subject: string;
  body: string;
  /** Plain-English list of the genuine facts this draft used — shown as chips. */
  used: string[];
  /** Things he should know before sending (missing data, audience mismatch). */
  warnings: string[];
};

export type ResearchResult = {
  person: Person;
  linkedinBlocked: boolean;
  linkedinNote: string;
  company: Company;
  websiteNote: string;
  audit: DraftAudit | null;
  auditNote: string;
};
