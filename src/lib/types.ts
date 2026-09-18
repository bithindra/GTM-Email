export type Prospect = {
  id: string;
  name: string;
  title: string;
  company: string;
  companySize: string; // employee band, e.g. "11-50"
  industry: string;
  country: string;
  city: string;
  linkedin: string;
  email: string;
  emailStatus: "verified" | "guessed" | "unknown";
  createdAt: string;
  // The business's own website, canonical form "https://host". Set by the audit
  // outreach flow; joins a prospect to its row in `audits`.
  website?: string;
  // Contact number, when the source had one (Maps-scraped leads usually do). Not used
  // by the mailer — kept so a saved list can also be worked by phone.
  phone?: string;
  // Optional carriers for Apollo live-search → enrichment (not persisted as columns)
  apolloId?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
};

export type Template = {
  id: string;
  name: string;
  subject: string;
  body: string; // supports {{first_name}}, {{company}}, {{title}}, {{city}}, {{country}}
  updatedAt: string;
  // "outreach" = 1:1 cold-email styling (default). "newsletter" = broadcast/company
  // update rendered in a styled shell, personalized by name only. (Legacy — `format`
  // is the source of truth when set.)
  type?: "outreach" | "newsletter";
  // Render format: "plain" (looks hand-typed, most human/inboxing), "rich" (light
  // 1:1 styling), "newsletter" (branded card). Bodies support {a|b} spintax.
  format?: "plain" | "rich" | "newsletter";
  // Open-pixel + click tracking. Off = no tracking domain/pixel (more human, better
  // inboxing). Defaults: on for rich/newsletter, off for plain.
  track?: boolean;
  // Free-text grouping — the offer/audience this mail belongs to, e.g. "AI Consulting",
  // "AI Workshop", "XamBaaz". Deliberately not an enum: typing a new value creates a new
  // category. Metadata only — never reaches the wire.
  category?: string | null;
};

export type RecipientStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "failed";

export type Recipient = {
  id: string;
  campaignId: string;
  prospectId: string;
  name: string;
  email: string;
  company: string;
  status: RecipientStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  followupSentAt: string | null;
  followup2SentAt: string | null;
  opens: number;
  clicks: number;
};

export type Attachment = {
  filename: string;
  contentType: string;
  content: string; // base64-encoded file bytes
};

export type Campaign = {
  id: string;
  name: string;
  templateId: string;
  followupTemplateId: string | null; // second mailer
  followupDays: number; // days after first send to trigger follow-up
  followup2TemplateId: string | null; // third mailer ("breakup"), sent after the first follow-up
  followup2Days: number; // days after the FIRST follow-up to trigger the second
  status: "draft" | "scheduled" | "sending" | "sent";
  scheduledAt: string | null; // ISO; when set + status scheduled, dispatcher sends at/after this time
  createdAt: string;
  recipientCount: number;
  attachments: Attachment[]; // files sent with every mail in this campaign (incl. follow-ups)
  fromMailbox: string | null; // sending Gmail address (mailbox id); null = primary mailbox
  sendTz: string | null; // recipients' IANA zone for the send window (see send-window.ts); null = home zone
};

export type List = {
  id: string;
  name: string;
  source: string; // "search" | "upload" | "manual"
  count: number;
  createdAt: string;
};

export type SourcingRequest = {
  id: string;
  filters: SearchFilters;
  status: "pending" | "fulfilled" | "rejected";
  note: string;
  resultListId: string | null;
  importedCount: number;
  createdAt: string;
  fulfilledAt: string | null;
};

export type SearchFilters = {
  countries: string[];
  sizes: string[]; // employee bands
  titles: string[];
  industries: string[];
  seniorities?: string[]; // Apollo person_seniorities values
  revenueRanges?: string[]; // REVENUE_BANDS labels
  keywords: string;
  limit: number;
};

/**
 * One Maveriko audit of one business website, cached so a re-scrape of the same
 * area does not re-audit sites we already scored. `website` is the normalized
 * key from normalizeWebsite() and is the primary key.
 */
export type AuditRecord = {
  website: string;
  host: string;
  status: "ok" | "failed";
  seoScore: number | null;
  geoScore: number | null;
  geoPageScore: number | null;
  seoBand: string;
  geoBand: string;
  auditId: string;
  reportUrl: string;
  topIssue: string;
  topFix: string;
  error: string;
  checkedAt: string;
};
