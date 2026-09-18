import { v4 as uuid } from "uuid";
import type { Prospect, Template, Campaign, Recipient, RecipientStatus, List, SourcingRequest, SearchFilters, Attachment, AuditRecord } from "./types";
import { TEMPLATE_LIBRARY } from "./templateLibrary";

// Templates list in category order (uncategorised last), newest-edited first inside a
// group — so the UI can render category headers by walking the list once.
function templateOrder(a: Template, b: Template): number {
  const ca = a.category || "￿";
  const cb = b.category || "￿";
  if (ca !== cb) return ca.localeCompare(cb);
  return b.updatedAt.localeCompare(a.updatedAt);
}

/* ============================================================
   Storage abstraction.
   - If DATABASE_URL (postgres) is set -> Neon Postgres backend.
   - Otherwise -> in-memory store seeded with demo data.
   Both implement the same async Store interface.
   ============================================================ */

export interface Store {
  listProspects(): Promise<Prospect[]>;
  saveProspects(p: Prospect[]): Promise<Prospect[]>;
  getProspectIdsByEmails(emails: string[]): Promise<Map<string, string>>; // lowercased email -> id
  getProspectsByIds(ids: string[]): Promise<Prospect[]>;
  getTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | null>;
  saveTemplate(t: Omit<Template, "updatedAt"> & { id?: string }): Promise<Template>;
  deleteTemplate(id: string): Promise<void>;
  getCampaigns(): Promise<Campaign[]>; // attachments omitted (returned as []) to keep payloads small
  getCampaign(id: string): Promise<Campaign | null>; // attachments omitted — fetch via getCampaignAttachments
  getCampaignAttachments(id: string): Promise<Attachment[]>; // loads the base64 blobs only when sending
  createCampaign(name: string, templateId: string, prospectIds: string[], followupTemplateId?: string | null, followupDays?: number, scheduledAt?: string | null, attachments?: Attachment[], followup2TemplateId?: string | null, followup2Days?: number, fromMailbox?: string | null, sendTz?: string | null): Promise<Campaign>;
  setCampaignStatus(id: string, status: Campaign["status"]): Promise<void>;
  deleteCampaign(id: string): Promise<void>;
  dueScheduledCampaigns(): Promise<Campaign[]>;
  getRecipients(campaignId: string): Promise<Recipient[]>;
  getRecipient(id: string): Promise<Recipient | null>;
  markSent(recipientId: string): Promise<void>;
  markFollowupSent(recipientId: string): Promise<void>;
  markFollowup2Sent(recipientId: string): Promise<void>;
  markFailed(recipientId: string): Promise<void>;
  bouncedEmails(): Promise<Set<string>>; // lowercased emails that hard-bounced in ANY campaign
  suppress(email: string, reason: string): Promise<void>; // unsubscribe / complaint — permanent opt-out
  suppressedEmails(): Promise<Set<string>>; // bounced ∪ unsubscribed — never email these
  deleteRecipients(campaignId: string, ids: string[]): Promise<number>;
  requeueBounced(campaignId: string): Promise<number>; // bounced → queued (retry after a mailbox-limit misfire)
  // Undo bounces that engagement proves were false: a mail that was opened, clicked or
  // replied to was demonstrably delivered, so a "bounced" status on it is wrong.
  // Returns the corrected rows. `dryRun` reports what would change without writing.
  recoverFalseBounces(dryRun?: boolean): Promise<{ email: string; campaignId: string; evidence: string }[]>;
  recordEvent(recipientId: string, type: "delivered" | "opened" | "clicked" | "replied" | "bounced"): Promise<void>;
  allRecipients(): Promise<Recipient[]>;
  recipientsToReconcile(): Promise<Pick<Recipient, "id" | "email" | "status" | "sentAt">[]>; // lean rows for the inbox scan
  statsSummary(): Promise<{ prospects: number; sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number }>;
  campaignPerformance(): Promise<{ id: string; name: string; status: Campaign["status"]; recipientCount: number; recipients: number; sent: number; delivered: number; opened: number; clicked: number; replied: number }[]>;
  templatePerformance(): Promise<{ id: string; campaigns: number; sent: number; opened: number; clicked: number; replied: number }[]>; // results attributed to the campaign's FIRST mail template
  dueFollowups(): Promise<{ campaign: Campaign; recipient: Recipient }[]>;
  dueFollowups2(): Promise<{ campaign: Campaign; recipient: Recipient }[]>;
  createList(name: string, prospectIds: string[], source: string): Promise<List>;
  getLists(): Promise<List[]>;
  getList(id: string): Promise<List | null>;
  getListMembers(listId: string): Promise<Prospect[]>;
  addToList(listId: string, prospectIds: string[]): Promise<void>;
  removeFromList(listId: string, prospectId: string): Promise<void>;
  deleteList(id: string): Promise<void>;
  updateProspect(id: string, patch: Partial<Prospect>): Promise<Prospect | null>;
  sentTodayCount(): Promise<number>;
  sentTodayByMailbox(mailbox: string | null): Promise<number>; // today's sends from one mailbox (warm-up cap)
  createSourcingRequest(filters: SearchFilters): Promise<SourcingRequest>;
  listSourcingRequests(): Promise<SourcingRequest[]>;
  getSourcingRequest(id: string): Promise<SourcingRequest | null>;
  fulfillSourcingRequest(id: string, info: { resultListId: string | null; importedCount: number; note: string; status?: SourcingRequest["status"] }): Promise<void>;
  // Maveriko audit cache — keyed by the normalized website, so re-scraping the
  // same area does not re-audit sites we already scored.
  getAuditsByWebsites(websites: string[]): Promise<Map<string, AuditRecord>>;
  upsertAudits(rows: AuditRecord[]): Promise<void>;
  listAudits(limit?: number): Promise<AuditRecord[]>;
}

// Legacy marker: a single key recording that the whole starter library had been
// seeded. Kept only so existing databases can be migrated to per-key markers.
const TEMPLATE_LIBRARY_MARKER = "template_library_v1";
// The keys that shipped under the legacy marker. A database carrying that marker
// already has these three rows, so they must never be re-inserted.
const TEMPLATE_LIBRARY_V1_KEYS = ["brandvibe-ai-workshop", "brandvibe-owners-roi", "xambaaz-principal-intro"];
// Per-preset marker. Seeding one key at a time is what lets a NEW preset reach an
// existing database without duplicating the ones already there — bumping a single
// whole-library marker would re-insert every template, including the two with real
// send history behind them.
const templateSeedKey = (key: string) => `tpl_seed:${key}`;

/* ---------------- In-memory backend ---------------- */
class MemoryStore implements Store {
  prospects: Prospect[] = [];
  templates: Template[] = [];
  campaigns: Campaign[] = [];
  recipients: Recipient[] = [];
  sourcingRequests: SourcingRequest[] = [];
  lists: List[] = [];
  listMembers: { listId: string; prospectId: string }[] = [];
  suppressions = new Set<string>(); // lowercased emails that unsubscribed / complained
  audits = new Map<string, AuditRecord>(); // normalized website -> last audit

  constructor() {
    this.seed();
  }

  private seed() {
    const now = Date.now();
    // The starter mail library — same 8 presets the Postgres backend seeds.
    this.templates = TEMPLATE_LIBRARY.map((p) => ({
      id: uuid(),
      name: p.name,
      subject: p.subject,
      body: p.body,
      category: p.category,
      format: p.format,
      track: p.track,
      type: p.format === "newsletter" ? ("newsletter" as const) : ("outreach" as const),
      updatedAt: new Date().toISOString(),
    }));
    const tmpl = this.templates[0];

    const seedProspects: Array<Partial<Prospect>> = [
      { name: "Sofia Garcia", title: "Founder & CEO", company: "Nova Labs", companySize: "11-50", industry: "SaaS", country: "United States", city: "San Francisco", email: "sofia@novalabs.com" },
      { name: "Liam Müller", title: "Co-Founder", company: "Vertex Systems", companySize: "51-200", industry: "Fintech", country: "Germany", city: "Berlin", email: "liam@vertexsystems.com" },
      { name: "Aarav Mehta", title: "Founder", company: "Lumen AI", companySize: "1-10", industry: "Healthtech", country: "India", city: "Bengaluru", email: "aarav@lumenai.com" },
      { name: "Mia Chen", title: "Managing Director", company: "Atlas Logistics", companySize: "201-500", industry: "Logistics", country: "Singapore", city: "Singapore", email: "mia@atlaslogistics.com" },
      { name: "Omar Khan", title: "Owner", company: "Beacon Foods", companySize: "11-50", industry: "E-commerce", country: "United Arab Emirates", city: "Dubai", email: "omar@beaconfoods.com" },
      { name: "Elena Popov", title: "CEO", company: "Helio Studios", companySize: "51-200", industry: "Marketing", country: "United Kingdom", city: "London", email: "elena@heliostudios.com" },
    ];
    this.prospects = seedProspects.map((p) => ({
      id: uuid(),
      emailStatus: "verified" as const,
      linkedin: `https://www.linkedin.com/in/${(p.name || "").toLowerCase().replace(/\s+/g, "-")}`,
      createdAt: new Date().toISOString(),
      ...p,
    })) as Prospect[];

    // Seed a sent campaign with varied statuses so the dashboard looks alive
    const camp: Campaign = {
      id: uuid(),
      name: "Q2 Global Founders — Wave 1",
      templateId: tmpl.id,
      followupTemplateId: null,
      followupDays: 7,
      followup2TemplateId: null,
      followup2Days: 7,
      status: "sent",
      scheduledAt: null,
      createdAt: new Date(now - 1000 * 60 * 60 * 72).toISOString(),
      recipientCount: this.prospects.length,
      attachments: [],
      fromMailbox: null,
      sendTz: null,
    };
    this.campaigns.push(camp);

    const statuses: RecipientStatus[] = ["replied", "clicked", "opened", "opened", "delivered", "bounced"];
    this.recipients = this.prospects.map((p, i) => {
      const st = statuses[i % statuses.length];
      const sentAt = new Date(now - 1000 * 60 * 60 * (70 - i * 2)).toISOString();
      const reached = ["delivered", "opened", "clicked", "replied"].includes(st);
      const opened = ["opened", "clicked", "replied"].includes(st);
      const clicked = ["clicked", "replied"].includes(st);
      const replied = st === "replied";
      return {
        id: uuid(),
        campaignId: camp.id,
        prospectId: p.id,
        name: p.name,
        email: p.email,
        company: p.company,
        status: st,
        sentAt,
        deliveredAt: reached ? sentAt : null,
        openedAt: opened ? new Date(now - 1000 * 60 * 60 * (60 - i * 2)).toISOString() : null,
        clickedAt: clicked ? new Date(now - 1000 * 60 * 60 * (55 - i * 2)).toISOString() : null,
        repliedAt: replied ? new Date(now - 1000 * 60 * 60 * (50 - i * 2)).toISOString() : null,
        followupSentAt: null,
        followup2SentAt: null,
        opens: opened ? Math.floor(Math.random() * 4) + 1 : 0,
        clicks: clicked ? Math.floor(Math.random() * 2) + 1 : 0,
      };
    });
  }

  async listProspects() {
    return [...this.prospects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveProspects(incoming: Prospect[]) {
    const byEmail = new Set(this.prospects.map((p) => p.email));
    const added: Prospect[] = [];
    for (const p of incoming) {
      if (p.email && byEmail.has(p.email)) continue;
      byEmail.add(p.email);
      this.prospects.push(p);
      added.push(p);
    }
    return added;
  }
  async getProspectIdsByEmails(emails: string[]) {
    const want = new Set(emails.map((e) => (e || "").toLowerCase()));
    const out = new Map<string, string>();
    for (const p of this.prospects) {
      const e = (p.email || "").toLowerCase();
      if (e && want.has(e)) out.set(e, p.id);
    }
    return out;
  }
  async getProspectsByIds(ids: string[]) {
    const want = new Set(ids);
    return this.prospects.filter((p) => want.has(p.id));
  }
  async getTemplates() {
    return [...this.templates].sort(templateOrder);
  }
  async getTemplate(id: string) {
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async saveTemplate(t: Omit<Template, "updatedAt"> & { id?: string }) {
    const format = t.format || (t.type === "newsletter" ? "newsletter" : "rich");
    const type: Template["type"] = format === "newsletter" ? "newsletter" : "outreach";
    const track = typeof t.track === "boolean" ? t.track : format !== "plain";
    const category = t.category?.trim() || null;
    const existing = t.id ? this.templates.find((x) => x.id === t.id) : null;
    if (existing) {
      existing.name = t.name;
      existing.subject = t.subject;
      existing.body = t.body;
      existing.type = type;
      existing.format = format;
      existing.track = track;
      existing.category = category;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    const created: Template = { id: t.id || uuid(), name: t.name, subject: t.subject, body: t.body, type, format, track, category, updatedAt: new Date().toISOString() };
    this.templates.push(created);
    return created;
  }
  async deleteTemplate(id: string) {
    this.templates = this.templates.filter((t) => t.id !== id);
  }
  async getCampaigns() {
    return [...this.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => ({ ...c, attachments: [] }));
  }
  async getCampaign(id: string) {
    const c = this.campaigns.find((x) => x.id === id);
    return c ? { ...c, attachments: [] } : null;
  }
  async getCampaignAttachments(id: string) {
    return this.campaigns.find((c) => c.id === id)?.attachments ?? [];
  }
  async createCampaign(name: string, templateId: string, prospectIds: string[], followupTemplateId: string | null = null, followupDays = 7, scheduledAt: string | null = null, attachments: Attachment[] = [], followup2TemplateId: string | null = null, followup2Days = 7, fromMailbox: string | null = null, sendTz: string | null = null) {
    const camp: Campaign = { id: uuid(), name, templateId, followupTemplateId, followupDays, followup2TemplateId, followup2Days, status: scheduledAt ? "scheduled" : "draft", scheduledAt, createdAt: new Date().toISOString(), recipientCount: prospectIds.length, attachments, fromMailbox, sendTz };
    this.campaigns.push(camp);
    for (const pid of prospectIds) {
      const p = this.prospects.find((x) => x.id === pid);
      if (!p) continue;
      this.recipients.push({
        id: uuid(), campaignId: camp.id, prospectId: p.id, name: p.name, email: p.email, company: p.company,
        status: "queued", sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null, repliedAt: null, followupSentAt: null, followup2SentAt: null, opens: 0, clicks: 0,
      });
    }
    return camp;
  }
  async setCampaignStatus(id: string, status: Campaign["status"]) {
    const c = this.campaigns.find((x) => x.id === id);
    if (c) c.status = status;
  }
  async deleteCampaign(id: string) {
    this.campaigns = this.campaigns.filter((c) => c.id !== id);
    this.recipients = this.recipients.filter((r) => r.campaignId !== id);
  }
  async dueScheduledCampaigns() {
    const now = Date.now();
    return this.campaigns.filter((c) => c.status === "scheduled" && c.scheduledAt && new Date(c.scheduledAt).getTime() <= now);
  }
  async getRecipients(campaignId: string) {
    return this.recipients.filter((r) => r.campaignId === campaignId);
  }
  async getRecipient(id: string) {
    return this.recipients.find((r) => r.id === id) ?? null;
  }
  async markSent(recipientId: string) {
    const r = this.recipients.find((x) => x.id === recipientId);
    if (r) { r.status = "sent"; r.sentAt = new Date().toISOString(); }
  }
  async markFollowupSent(recipientId: string) {
    const r = this.recipients.find((x) => x.id === recipientId);
    if (r) r.followupSentAt = new Date().toISOString();
  }
  async markFollowup2Sent(recipientId: string) {
    const r = this.recipients.find((x) => x.id === recipientId);
    if (r) r.followup2SentAt = new Date().toISOString();
  }
  async markFailed(recipientId: string) {
    const r = this.recipients.find((x) => x.id === recipientId);
    if (r) r.status = "failed";
  }
  async bouncedEmails() {
    return new Set(this.recipients.filter((r) => r.status === "bounced").map((r) => (r.email || "").toLowerCase()));
  }
  async suppress(email: string, _reason: string) {
    const e = (email || "").toLowerCase();
    if (e) this.suppressions.add(e);
  }
  async suppressedEmails() {
    const out = await this.bouncedEmails();
    for (const e of this.suppressions) out.add(e);
    return out;
  }
  async recoverFalseBounces(dryRun = false) {
    const out: { email: string; campaignId: string; evidence: string }[] = [];
    for (const r of this.recipients) {
      if (r.status !== "bounced") continue;
      const ev = r.repliedAt ? "replied" : r.clickedAt ? "clicked" : r.openedAt ? "opened" : "";
      if (!ev) continue;
      out.push({ email: r.email, campaignId: r.campaignId, evidence: ev });
      if (!dryRun) r.status = r.repliedAt ? "replied" : r.clickedAt ? "clicked" : "opened";
    }
    return out;
  }
  async requeueBounced(campaignId: string) {
    let n = 0;
    for (const r of this.recipients) {
      if (r.campaignId === campaignId && r.status === "bounced") {
        r.status = "queued"; r.sentAt = null; r.deliveredAt = null; n++;
      }
    }
    if (n) { const c = this.campaigns.find((x) => x.id === campaignId); if (c && c.status === "sent") c.status = "sending"; }
    return n;
  }
  async deleteRecipients(campaignId: string, ids: string[]) {
    const set = new Set(ids);
    const before = this.recipients.length;
    this.recipients = this.recipients.filter((r) => !(r.campaignId === campaignId && set.has(r.id)));
    const removed = before - this.recipients.length;
    const c = this.campaigns.find((x) => x.id === campaignId);
    if (c) c.recipientCount = this.recipients.filter((r) => r.campaignId === campaignId).length;
    return removed;
  }
  async dueFollowups() {
    const out: { campaign: Campaign; recipient: Recipient }[] = [];
    const now = Date.now();
    for (const c of this.campaigns) {
      if (!c.followupTemplateId) continue;
      for (const r of this.recipients.filter((x) => x.campaignId === c.id)) {
        if (r.followupSentAt || !r.sentAt) continue;
        if (["replied", "bounced", "queued", "failed"].includes(r.status)) continue;
        if (now - new Date(r.sentAt).getTime() >= c.followupDays * 86400000) out.push({ campaign: c, recipient: r });
      }
    }
    return out;
  }
  async dueFollowups2() {
    const out: { campaign: Campaign; recipient: Recipient }[] = [];
    const now = Date.now();
    for (const c of this.campaigns) {
      if (!c.followup2TemplateId) continue;
      for (const r of this.recipients.filter((x) => x.campaignId === c.id)) {
        if (r.followup2SentAt || !r.followupSentAt) continue;
        if (["replied", "bounced", "queued", "failed"].includes(r.status)) continue;
        if (now - new Date(r.followupSentAt).getTime() >= c.followup2Days * 86400000) out.push({ campaign: c, recipient: r });
      }
    }
    return out;
  }
  async recordEvent(recipientId: string, type: "delivered" | "opened" | "clicked" | "replied" | "bounced") {
    const r = this.recipients.find((x) => x.id === recipientId);
    if (!r) return;
    const now = new Date().toISOString();
    const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, replied: 5, bounced: 1, failed: 1 };
    if (type === "delivered") { r.deliveredAt ||= now; }
    if (type === "opened") { r.openedAt ||= now; r.opens += 1; }
    if (type === "clicked") { r.clickedAt ||= now; r.clicks += 1; }
    if (type === "replied") { r.repliedAt ||= now; }
    // A reply outranks a later bounce notice — see the Postgres version for why.
    if (type === "bounced") { if (!r.repliedAt && r.status !== "replied") r.status = "bounced"; return; }
    if ((rank[type] ?? 0) >= (rank[r.status] ?? 0)) r.status = type as RecipientStatus;
  }
  async allRecipients() {
    return [...this.recipients];
  }
  async recipientsToReconcile() {
    return this.recipients
      .filter((r) => r.sentAt && r.status !== "replied" && r.status !== "bounced")
      .map((r) => ({ id: r.id, email: r.email, status: r.status, sentAt: r.sentAt }));
  }
  async statsSummary() {
    const rs = this.recipients;
    return {
      prospects: this.prospects.length,
      sent: rs.filter((r) => r.sentAt).length,
      delivered: rs.filter((r) => r.deliveredAt).length,
      opened: rs.filter((r) => r.openedAt).length,
      clicked: rs.filter((r) => r.clickedAt).length,
      replied: rs.filter((r) => r.repliedAt).length,
      bounced: rs.filter((r) => r.status === "bounced").length,
    };
  }
  async campaignPerformance() {
    return [...this.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => {
      const rs = this.recipients.filter((r) => r.campaignId === c.id);
      return {
        id: c.id, name: c.name, status: c.status, recipientCount: c.recipientCount,
        recipients: rs.length || c.recipientCount,
        sent: rs.filter((r) => r.sentAt).length,
        delivered: rs.filter((r) => r.deliveredAt).length,
        opened: rs.filter((r) => r.openedAt).length,
        clicked: rs.filter((r) => r.clickedAt).length,
        replied: rs.filter((r) => r.repliedAt).length,
      };
    });
  }
  async templatePerformance() {
    const out = new Map<string, { id: string; campaigns: number; sent: number; opened: number; clicked: number; replied: number }>();
    for (const c of this.campaigns) {
      const e = out.get(c.templateId) ?? { id: c.templateId, campaigns: 0, sent: 0, opened: 0, clicked: 0, replied: 0 };
      e.campaigns++;
      for (const r of this.recipients.filter((x) => x.campaignId === c.id)) {
        if (r.sentAt) e.sent++;
        if (r.openedAt) e.opened++;
        if (r.clickedAt) e.clicked++;
        if (r.repliedAt) e.replied++;
      }
      out.set(c.templateId, e);
    }
    return [...out.values()];
  }
  async createList(name: string, prospectIds: string[], source: string) {
    let list = this.lists.find((l) => l.name === name);
    if (!list) {
      list = { id: uuid(), name, source, count: 0, createdAt: new Date().toISOString() };
      this.lists.push(list);
    }
    for (const pid of prospectIds) {
      if (!this.listMembers.some((m) => m.listId === list!.id && m.prospectId === pid)) {
        this.listMembers.push({ listId: list.id, prospectId: pid });
      }
    }
    list.count = this.listMembers.filter((m) => m.listId === list!.id).length;
    return list;
  }
  async getLists() {
    return this.lists.map((l) => ({ ...l, count: this.listMembers.filter((m) => m.listId === l.id).length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getList(id: string) {
    const l = this.lists.find((x) => x.id === id);
    if (!l) return null;
    return { ...l, count: this.listMembers.filter((m) => m.listId === id).length };
  }
  async getListMembers(listId: string) {
    const ids = new Set(this.listMembers.filter((m) => m.listId === listId).map((m) => m.prospectId));
    return this.prospects.filter((p) => ids.has(p.id));
  }
  async addToList(listId: string, prospectIds: string[]) {
    for (const pid of prospectIds) {
      if (!this.listMembers.some((m) => m.listId === listId && m.prospectId === pid)) {
        this.listMembers.push({ listId, prospectId: pid });
      }
    }
  }
  async removeFromList(listId: string, prospectId: string) {
    this.listMembers = this.listMembers.filter((m) => !(m.listId === listId && m.prospectId === prospectId));
  }
  async deleteList(id: string) {
    this.lists = this.lists.filter((l) => l.id !== id);
    this.listMembers = this.listMembers.filter((m) => m.listId !== id);
  }
  async updateProspect(id: string, patch: Partial<Prospect>) {
    const p = this.prospects.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch, { id: p.id });
    return p;
  }
  async getAuditsByWebsites(websites: string[]) {
    const out = new Map<string, AuditRecord>();
    for (const w of websites) {
      const a = this.audits.get(w);
      if (a) out.set(w, a);
    }
    return out;
  }
  async upsertAudits(rows: AuditRecord[]) {
    for (const r of rows) this.audits.set(r.website, r);
  }
  async listAudits(limit = 500) {
    return [...this.audits.values()]
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
      .slice(0, limit);
  }
  async sentTodayCount() {
    const today = new Date().toDateString();
    return this.recipients.filter((r) => (r.sentAt && new Date(r.sentAt).toDateString() === today))
      .length + this.recipients.filter((r) => r.followupSentAt && new Date(r.followupSentAt).toDateString() === today).length;
  }
  async sentTodayByMailbox(mailbox: string | null) {
    const today = new Date().toDateString();
    const ids = new Set(this.campaigns.filter((c) => (c.fromMailbox ?? null) === (mailbox ?? null)).map((c) => c.id));
    let n = 0;
    for (const r of this.recipients) {
      if (!ids.has(r.campaignId)) continue;
      const on = (d: string | null) => d && new Date(d).toDateString() === today;
      if (on(r.sentAt) || on(r.followupSentAt) || on(r.followup2SentAt)) n++;
    }
    return n;
  }
  async createSourcingRequest(filters: SearchFilters) {
    const req: SourcingRequest = { id: uuid(), filters, status: "pending", note: "", resultListId: null, importedCount: 0, createdAt: new Date().toISOString(), fulfilledAt: null };
    this.sourcingRequests.push(req);
    return req;
  }
  async listSourcingRequests() {
    return [...this.sourcingRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getSourcingRequest(id: string) {
    return this.sourcingRequests.find((r) => r.id === id) ?? null;
  }
  async fulfillSourcingRequest(id: string, info: { resultListId: string | null; importedCount: number; note: string; status?: SourcingRequest["status"] }) {
    const r = this.sourcingRequests.find((x) => x.id === id);
    if (!r) return;
    r.status = info.status ?? "fulfilled";
    r.resultListId = info.resultListId;
    r.importedCount = info.importedCount;
    r.note = info.note;
    r.fulfilledAt = new Date().toISOString();
  }
}

/* ---------------- Postgres (Neon) backend ---------------- */
class PgStore implements Store {
  // Loosely typed: neon's tagged-template result is a broad union; we map rows by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sql: ((...args: unknown[]) => Promise<Record<string, any>[]>) | null = null;
  private ready: Promise<void> | null = null;

  private async db() {
    if (!this.sql) {
      const { neon } = await import("@neondatabase/serverless");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.sql = neon(process.env.DATABASE_URL!) as any;
    }
    if (!this.ready) this.ready = this.init();
    await this.ready;
    return this.sql!;
  }

  private async init() {
    const sql = this.sql!;
    await sql`CREATE TABLE IF NOT EXISTS prospects (
      id text PRIMARY KEY, name text, title text, company text, company_size text,
      industry text, country text, city text, linkedin text, email text UNIQUE,
      email_status text, created_at timestamptz DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS templates (
      id text PRIMARY KEY, name text, subject text, body text, updated_at timestamptz DEFAULT now())`;
    await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS type text DEFAULT 'outreach'`;
    await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS format text`;
    await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS track boolean`;
    await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS category text`;
    await sql`CREATE TABLE IF NOT EXISTS campaigns (
      id text PRIMARY KEY, name text, template_id text, status text, created_at timestamptz DEFAULT now())`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup_template_id text`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup_days int DEFAULT 7`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attachments text`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup2_template_id text`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup2_days int DEFAULT 7`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS from_mailbox text`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_tz text`;
    await sql`CREATE TABLE IF NOT EXISTS recipients (
      id text PRIMARY KEY, campaign_id text, prospect_id text, name text, email text, company text,
      status text, sent_at timestamptz, delivered_at timestamptz, opened_at timestamptz,
      clicked_at timestamptz, replied_at timestamptz, opens int DEFAULT 0, clicks int DEFAULT 0)`;
    await sql`ALTER TABLE recipients ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz`;
    await sql`ALTER TABLE recipients ADD COLUMN IF NOT EXISTS followup2_sent_at timestamptz`;
    await sql`CREATE TABLE IF NOT EXISTS sourcing_requests (
      id text PRIMARY KEY, filters text, status text DEFAULT 'pending', note text DEFAULT '',
      result_list_id text, imported_count int DEFAULT 0, created_at timestamptz DEFAULT now(), fulfilled_at timestamptz)`;
    await sql`CREATE TABLE IF NOT EXISTS lists (
      id text PRIMARY KEY, name text UNIQUE, source text, created_at timestamptz DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS list_members (
      list_id text, prospect_id text, PRIMARY KEY (list_id, prospect_id))`;
    await sql`CREATE TABLE IF NOT EXISTS suppressions (
      email text PRIMARY KEY, reason text, created_at timestamptz DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS app_meta (
      key text PRIMARY KEY, value text, created_at timestamptz DEFAULT now())`;
    // The business's own site, so a sent recipient can be traced back to the
    // audit that qualified it.
    await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS website text`;
    await sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone text`;
    // Maveriko audit cache. `website` is the normalized key from
    // normalizeWebsite() ("https://host") and is the primary key, so a re-scrape
    // of the same area re-uses scores instead of re-auditing.
    await sql`CREATE TABLE IF NOT EXISTS audits (
      website text PRIMARY KEY, host text, status text,
      seo_score int, geo_score int, geo_page_score int,
      seo_band text, geo_band text, audit_id text, report_url text,
      top_issue text, top_fix text, error text,
      checked_at timestamptz DEFAULT now())`;

    // Migrate the legacy whole-library marker to per-key markers, so a database
    // seeded before this change is not re-seeded with the three presets it has.
    const legacy = await sql`SELECT 1 FROM app_meta WHERE key=${TEMPLATE_LIBRARY_MARKER}`;
    if (legacy.length) {
      for (const k of TEMPLATE_LIBRARY_V1_KEYS) {
        await sql`INSERT INTO app_meta (key, value) VALUES (${templateSeedKey(k)}, 'migrated')
          ON CONFLICT (key) DO NOTHING`;
      }
    }

    // Seed each preset exactly once, guarded by its own app_meta marker rather
    // than "is the templates table empty" so it (a) still fires on a database
    // that already has templates, (b) never resurrects a preset the user
    // deleted, and (c) lets a new preset ship to an existing database alone.
    for (const p of TEMPLATE_LIBRARY) {
      const marker = templateSeedKey(p.key);
      const done = await sql`SELECT 1 FROM app_meta WHERE key=${marker}`;
      if (done.length) continue;
      const type = p.format === "newsletter" ? "newsletter" : "outreach";
      await sql`INSERT INTO templates (id, name, subject, body, type, format, track, category, updated_at)
        VALUES (${uuid()}, ${p.name}, ${p.subject}, ${p.body}, ${type}, ${p.format}, ${p.track}, ${p.category}, now())`;
      await sql`INSERT INTO app_meta (key, value) VALUES (${marker}, 'seeded') ON CONFLICT (key) DO NOTHING`;
    }
  }

  private mapProspect(r: Record<string, unknown>): Prospect {
    return {
      id: r.id as string, name: r.name as string, title: r.title as string, company: r.company as string,
      companySize: r.company_size as string, industry: r.industry as string, country: r.country as string,
      city: r.city as string, linkedin: r.linkedin as string, email: (r.email as string) || "",
      emailStatus: (r.email_status as Prospect["emailStatus"]) || "unknown",
      website: (r.website as string) || undefined,
      phone: (r.phone as string) || undefined,
      createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
  private mapRecipient(r: Record<string, unknown>): Recipient {
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return {
      id: r.id as string, campaignId: r.campaign_id as string, prospectId: r.prospect_id as string,
      name: r.name as string, email: r.email as string, company: r.company as string,
      status: r.status as RecipientStatus, sentAt: iso(r.sent_at), deliveredAt: iso(r.delivered_at),
      openedAt: iso(r.opened_at), clickedAt: iso(r.clicked_at), repliedAt: iso(r.replied_at),
      followupSentAt: iso(r.followup_sent_at),
      followup2SentAt: iso(r.followup2_sent_at),
      opens: (r.opens as number) || 0, clicks: (r.clicks as number) || 0,
    };
  }
  private mapCampaign(r: Record<string, unknown>): Campaign {
    return {
      id: r.id as string, name: r.name as string, templateId: r.template_id as string,
      followupTemplateId: (r.followup_template_id as string) || null,
      followupDays: (r.followup_days as number) ?? 7,
      followup2TemplateId: (r.followup2_template_id as string) || null,
      followup2Days: (r.followup2_days as number) ?? 7,
      status: r.status as Campaign["status"],
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at as string).toISOString() : null,
      createdAt: new Date(r.created_at as string).toISOString(),
      recipientCount: (r.rc as number) ?? 0,
      attachments: r.attachments ? (JSON.parse(r.attachments as string) as Attachment[]) : [],
      fromMailbox: (r.from_mailbox as string) || null,
      sendTz: (r.send_tz as string) || null,
    };
  }

  async listProspects() {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM prospects ORDER BY created_at DESC LIMIT 1000`;
    return rows.map((r) => this.mapProspect(r));
  }
  async saveProspects(incoming: Prospect[]) {
    const sql = await this.db();
    if (!incoming.length) return [];
    // Dedupe within the batch by email, then insert all rows in ONE query via
    // unnest (was one round-trip per prospect — far too slow for big lists).
    const seen = new Set<string>();
    const uniq = incoming.filter((p) => {
      const e = (p.email || "").toLowerCase();
      if (e && seen.has(e)) return false;
      if (e) seen.add(e);
      return true;
    });
    const col = (f: (p: Prospect) => string) => uniq.map(f);
    const rows = await sql`
      INSERT INTO prospects (id,name,title,company,company_size,industry,country,city,linkedin,email,email_status,website,phone,created_at)
      SELECT t.id,t.name,t.title,t.company,t.company_size,t.industry,t.country,t.city,t.linkedin,NULLIF(t.email,''),t.email_status,NULLIF(t.website,''),NULLIF(t.phone,''),now()
      FROM unnest(
        ${col((p) => p.id)}::text[], ${col((p) => p.name || "")}::text[], ${col((p) => p.title || "")}::text[],
        ${col((p) => p.company || "")}::text[], ${col((p) => p.companySize || "")}::text[], ${col((p) => p.industry || "")}::text[],
        ${col((p) => p.country || "")}::text[], ${col((p) => p.city || "")}::text[], ${col((p) => p.linkedin || "")}::text[],
        ${col((p) => (p.email || "").toLowerCase())}::text[], ${col((p) => p.emailStatus || "unknown")}::text[],
        ${col((p) => p.website || "")}::text[], ${col((p) => p.phone || "")}::text[]
      ) AS t(id,name,title,company,company_size,industry,country,city,linkedin,email,email_status,website,phone)
      ON CONFLICT (email) DO NOTHING
      RETURNING *`;
    return rows.map((r) => this.mapProspect(r));
  }
  async getProspectIdsByEmails(emails: string[]) {
    const out = new Map<string, string>();
    if (!emails.length) return out;
    const sql = await this.db();
    const lower = emails.map((e) => (e || "").toLowerCase()).filter(Boolean);
    const rows = await sql`SELECT id, email FROM prospects WHERE email = ANY(${lower}::text[])`;
    for (const r of rows) out.set((r.email as string || "").toLowerCase(), r.id as string);
    return out;
  }
  async getProspectsByIds(ids: string[]) {
    if (!ids.length) return [];
    const sql = await this.db();
    const rows = await sql`SELECT * FROM prospects WHERE id = ANY(${ids}::text[])`;
    return rows.map((r) => this.mapProspect(r));
  }
  private mapTemplate(r: Record<string, unknown>): Template {
    const type = (r.type as Template["type"]) || "outreach";
    const format = (r.format as Template["format"]) || (type === "newsletter" ? "newsletter" : "rich");
    return {
      id: r.id as string, name: r.name as string, subject: r.subject as string, body: r.body as string,
      type, format,
      track: typeof r.track === "boolean" ? r.track : format !== "plain",
      category: (r.category as string) || null,
      updatedAt: new Date(r.updated_at as string).toISOString(),
    };
  }
  async getTemplates() {
    const sql = await this.db();
    // Category order (uncategorised last), newest-edited first within a category.
    const rows = await sql`SELECT * FROM templates ORDER BY coalesce(category, '￿'), updated_at DESC`;
    return rows.map((r) => this.mapTemplate(r));
  }
  async getTemplate(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM templates WHERE id=${id}`;
    return rows.length ? this.mapTemplate(rows[0]) : null;
  }
  async saveTemplate(t: Omit<Template, "updatedAt"> & { id?: string }) {
    const sql = await this.db();
    const format = t.format || (t.type === "newsletter" ? "newsletter" : "rich");
    const type: Template["type"] = format === "newsletter" ? "newsletter" : "outreach";
    const track = typeof t.track === "boolean" ? t.track : format !== "plain";
    const category = t.category?.trim() || null;
    if (t.id) {
      const upd = await sql`UPDATE templates SET name=${t.name}, subject=${t.subject}, body=${t.body}, type=${type}, format=${format}, track=${track}, category=${category}, updated_at=now() WHERE id=${t.id} RETURNING *`;
      if (upd.length) return this.mapTemplate(upd[0]);
    }
    const id = t.id || uuid();
    const ins = await sql`INSERT INTO templates (id,name,subject,body,type,format,track,category,updated_at) VALUES (${id},${t.name},${t.subject},${t.body},${type},${format},${track},${category},now()) RETURNING *`;
    return this.mapTemplate(ins[0]);
  }
  async deleteTemplate(id: string) {
    const sql = await this.db();
    await sql`DELETE FROM templates WHERE id=${id}`;
  }
  // Explicit column list — deliberately EXCLUDES the base64 `attachments` blob so it
  // isn't shipped on every list/detail/poll/dispatch read (a major Neon-transfer leak).
  async getCampaigns() {
    const sql = await this.db();
    const rows = await sql`SELECT c.id, c.name, c.template_id, c.followup_template_id, c.followup_days,
      c.followup2_template_id, c.followup2_days, c.status, c.scheduled_at, c.from_mailbox, c.send_tz, c.created_at,
      (SELECT count(*)::int FROM recipients r WHERE r.campaign_id=c.id) AS rc
      FROM campaigns c ORDER BY created_at DESC`;
    return rows.map((r) => this.mapCampaign(r));
  }
  async getCampaign(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT c.id, c.name, c.template_id, c.followup_template_id, c.followup_days,
      c.followup2_template_id, c.followup2_days, c.status, c.scheduled_at, c.from_mailbox, c.send_tz, c.created_at,
      (SELECT count(*)::int FROM recipients r WHERE r.campaign_id=c.id) AS rc
      FROM campaigns c WHERE c.id=${id}`;
    if (!rows.length) return null;
    return this.mapCampaign(rows[0]);
  }
  async getCampaignAttachments(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT attachments FROM campaigns WHERE id=${id}`;
    return rows.length && rows[0].attachments ? (JSON.parse(rows[0].attachments as string) as Attachment[]) : [];
  }
  async createCampaign(name: string, templateId: string, prospectIds: string[], followupTemplateId: string | null = null, followupDays = 7, scheduledAt: string | null = null, attachments: Attachment[] = [], followup2TemplateId: string | null = null, followup2Days = 7, fromMailbox: string | null = null, sendTz: string | null = null) {
    const sql = await this.db();
    const id = uuid();
    const status = scheduledAt ? "scheduled" : "draft";
    const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;
    await sql`INSERT INTO campaigns (id,name,template_id,followup_template_id,followup_days,followup2_template_id,followup2_days,status,scheduled_at,attachments,from_mailbox,send_tz,created_at)
      VALUES (${id},${name},${templateId},${followupTemplateId},${followupDays},${followup2TemplateId},${followup2Days},${status},${scheduledAt},${attachmentsJson},${fromMailbox},${sendTz},now())`;
    // Bulk-insert all recipients in a single round-trip. Inserting one row per
    // prospect (as before) meant ~2 network calls × N prospects to Neon — a
    // 40-prospect list took ~18s and made the UI look frozen. This is one query.
    if (prospectIds.length) {
      await sql`INSERT INTO recipients (id,campaign_id,prospect_id,name,email,company,status,opens,clicks)
        SELECT gen_random_uuid()::text, ${id}, p.id, p.name, p.email, p.company, 'queued', 0, 0
        FROM prospects p WHERE p.id = ANY(${prospectIds})`;
    }
    return { id, name, templateId, followupTemplateId, followupDays, followup2TemplateId, followup2Days, status, scheduledAt, createdAt: new Date().toISOString(), recipientCount: prospectIds.length, attachments, fromMailbox, sendTz } as Campaign;
  }
  async setCampaignStatus(id: string, status: Campaign["status"]) {
    const sql = await this.db();
    await sql`UPDATE campaigns SET status=${status} WHERE id=${id}`;
  }
  async deleteCampaign(id: string) {
    const sql = await this.db();
    await sql`DELETE FROM recipients WHERE campaign_id=${id}`;
    await sql`DELETE FROM campaigns WHERE id=${id}`;
  }
  async dueScheduledCampaigns() {
    const sql = await this.db();
    const rows = await sql`SELECT c.id, c.name, c.template_id, c.followup_template_id, c.followup_days,
      c.followup2_template_id, c.followup2_days, c.status, c.scheduled_at, c.from_mailbox, c.send_tz, c.created_at,
      (SELECT count(*)::int FROM recipients r WHERE r.campaign_id=c.id) AS rc
      FROM campaigns c WHERE c.status='scheduled' AND c.scheduled_at IS NOT NULL AND c.scheduled_at <= now()`;
    return rows.map((r) => this.mapCampaign(r));
  }
  async getRecipients(campaignId: string) {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM recipients WHERE campaign_id=${campaignId} ORDER BY name`;
    return rows.map((r) => this.mapRecipient(r));
  }
  async getRecipient(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM recipients WHERE id=${id}`;
    return rows.length ? this.mapRecipient(rows[0]) : null;
  }
  async markSent(recipientId: string) {
    const sql = await this.db();
    await sql`UPDATE recipients SET status='sent', sent_at=now() WHERE id=${recipientId}`;
  }
  async markFollowupSent(recipientId: string) {
    const sql = await this.db();
    await sql`UPDATE recipients SET followup_sent_at=now() WHERE id=${recipientId}`;
  }
  async markFollowup2Sent(recipientId: string) {
    const sql = await this.db();
    await sql`UPDATE recipients SET followup2_sent_at=now() WHERE id=${recipientId}`;
  }
  async markFailed(recipientId: string) {
    const sql = await this.db();
    await sql`UPDATE recipients SET status='failed' WHERE id=${recipientId}`;
  }
  async bouncedEmails() {
    const sql = await this.db();
    const rows = await sql`SELECT DISTINCT lower(email) AS e FROM recipients WHERE status='bounced' AND email IS NOT NULL`;
    return new Set(rows.map((r) => r.e as string));
  }
  async suppress(email: string, reason: string) {
    const e = (email || "").toLowerCase();
    if (!e) return;
    const sql = await this.db();
    await sql`INSERT INTO suppressions (email, reason) VALUES (${e}, ${reason}) ON CONFLICT (email) DO NOTHING`;
  }
  async suppressedEmails() {
    const sql = await this.db();
    const rows = await sql`
      SELECT lower(email) AS e FROM recipients WHERE status='bounced' AND email IS NOT NULL
      UNION
      SELECT lower(email) AS e FROM suppressions WHERE email IS NOT NULL`;
    return new Set(rows.map((r) => r.e as string));
  }
  async recoverFalseBounces(dryRun = false) {
    const sql = await this.db();
    // Engagement is proof of delivery, so "bounced" on these rows is a false positive.
    // Restore the status the engagement itself implies rather than guessing.
    if (dryRun) {
      const rows = await sql`SELECT email, campaign_id,
          CASE WHEN replied_at IS NOT NULL THEN 'replied' WHEN clicked_at IS NOT NULL THEN 'clicked' ELSE 'opened' END AS evidence
        FROM recipients
        WHERE status='bounced' AND (replied_at IS NOT NULL OR clicked_at IS NOT NULL OR opened_at IS NOT NULL)`;
      return rows.map((r) => ({ email: r.email as string, campaignId: r.campaign_id as string, evidence: r.evidence as string }));
    }
    const rows = await sql`UPDATE recipients SET status =
        CASE WHEN replied_at IS NOT NULL THEN 'replied' WHEN clicked_at IS NOT NULL THEN 'clicked' ELSE 'opened' END
      WHERE status='bounced' AND (replied_at IS NOT NULL OR clicked_at IS NOT NULL OR opened_at IS NOT NULL)
      RETURNING email, campaign_id, status`;
    return rows.map((r) => ({ email: r.email as string, campaignId: r.campaign_id as string, evidence: r.status as string }));
  }
  async requeueBounced(campaignId: string) {
    const sql = await this.db();
    const rows = await sql`UPDATE recipients SET status='queued', sent_at=NULL, delivered_at=NULL WHERE campaign_id=${campaignId} AND status='bounced' RETURNING id`;
    if (rows.length) await sql`UPDATE campaigns SET status='sending' WHERE id=${campaignId} AND status='sent'`;
    return rows.length;
  }
  async deleteRecipients(campaignId: string, ids: string[]) {
    if (!ids.length) return 0;
    const sql = await this.db();
    const rows = await sql`DELETE FROM recipients WHERE campaign_id=${campaignId} AND id = ANY(${ids}) RETURNING id`;
    return rows.length;
  }
  async dueFollowups() {
    const sql = await this.db();
    const rows = await sql`
      SELECT r.*, c.id AS c_id, c.name AS c_name, c.template_id AS c_template_id,
             c.followup_template_id AS c_followup_template_id, c.followup_days AS c_followup_days,
             c.status AS c_status, c.created_at AS c_created_at, c.from_mailbox AS c_from_mailbox, c.send_tz AS c_send_tz
      FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE c.followup_template_id IS NOT NULL
        AND r.followup_sent_at IS NULL
        AND r.sent_at IS NOT NULL
        AND r.status NOT IN ('replied','bounced','queued','failed')
        AND r.sent_at <= now() - (c.followup_days * INTERVAL '1 day')`;
    return rows.map((r) => ({
      campaign: this.mapCampaign({ id: r.c_id, name: r.c_name, template_id: r.c_template_id, followup_template_id: r.c_followup_template_id, followup_days: r.c_followup_days, status: r.c_status, created_at: r.c_created_at, from_mailbox: r.c_from_mailbox, send_tz: r.c_send_tz }),
      recipient: this.mapRecipient(r),
    }));
  }
  async dueFollowups2() {
    const sql = await this.db();
    const rows = await sql`
      SELECT r.*, c.id AS c_id, c.name AS c_name, c.template_id AS c_template_id,
             c.followup_template_id AS c_followup_template_id, c.followup_days AS c_followup_days,
             c.followup2_template_id AS c_followup2_template_id, c.followup2_days AS c_followup2_days,
             c.status AS c_status, c.created_at AS c_created_at, c.from_mailbox AS c_from_mailbox, c.send_tz AS c_send_tz
      FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE c.followup2_template_id IS NOT NULL
        AND r.followup2_sent_at IS NULL
        AND r.followup_sent_at IS NOT NULL
        AND r.status NOT IN ('replied','bounced','queued','failed')
        AND r.followup_sent_at <= now() - (c.followup2_days * INTERVAL '1 day')`;
    return rows.map((r) => ({
      campaign: this.mapCampaign({ id: r.c_id, name: r.c_name, template_id: r.c_template_id, followup_template_id: r.c_followup_template_id, followup_days: r.c_followup_days, followup2_template_id: r.c_followup2_template_id, followup2_days: r.c_followup2_days, status: r.c_status, created_at: r.c_created_at, from_mailbox: r.c_from_mailbox, send_tz: r.c_send_tz }),
      recipient: this.mapRecipient(r),
    }));
  }
  async recordEvent(recipientId: string, type: "delivered" | "opened" | "clicked" | "replied" | "bounced") {
    const sql = await this.db();
    if (type === "delivered") await sql`UPDATE recipients SET delivered_at=COALESCE(delivered_at,now()), status=CASE WHEN status IN ('queued','sent') THEN 'delivered' ELSE status END WHERE id=${recipientId}`;
    if (type === "opened") await sql`UPDATE recipients SET opened_at=COALESCE(opened_at,now()), opens=opens+1, status=CASE WHEN status IN ('queued','sent','delivered') THEN 'opened' ELSE status END WHERE id=${recipientId}`;
    if (type === "clicked") await sql`UPDATE recipients SET clicked_at=COALESCE(clicked_at,now()), clicks=clicks+1, status=CASE WHEN status IN ('queued','sent','delivered','opened') THEN 'clicked' ELSE status END WHERE id=${recipientId}`;
    if (type === "replied") await sql`UPDATE recipients SET replied_at=COALESCE(replied_at,now()), status='replied' WHERE id=${recipientId}`;
    // A reply is proof the mail was delivered and read, so it outranks any later bounce
    // notice — without this guard a notice that merely quotes someone's address could
    // flip a real reply to "bounced" and erase it from the funnel.
    if (type === "bounced") await sql`UPDATE recipients SET status='bounced' WHERE id=${recipientId} AND replied_at IS NULL AND status <> 'replied'`;
  }
  async allRecipients() {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM recipients`;
    return rows.map((r) => this.mapRecipient(r));
  }
  async recipientsToReconcile() {
    const sql = await this.db();
    const rows = await sql`SELECT id, email, status, sent_at FROM recipients
      WHERE sent_at IS NOT NULL AND status NOT IN ('replied','bounced')`;
    return rows.map((r) => ({ id: r.id as string, email: (r.email as string) || "", status: r.status as RecipientStatus, sentAt: r.sent_at ? new Date(r.sent_at as string).toISOString() : null }));
  }
  async statsSummary() {
    const sql = await this.db();
    const rows = await sql`SELECT
      (SELECT count(*)::int FROM prospects) AS prospects,
      count(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
      count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replied,
      count(*) FILTER (WHERE status = 'bounced')::int AS bounced
      FROM recipients`;
    const r = rows[0] || {};
    return { prospects: (r.prospects as number) || 0, sent: (r.sent as number) || 0, delivered: (r.delivered as number) || 0, opened: (r.opened as number) || 0, clicked: (r.clicked as number) || 0, replied: (r.replied as number) || 0, bounced: (r.bounced as number) || 0 };
  }
  async campaignPerformance() {
    const sql = await this.db();
    const rows = await sql`SELECT c.id, c.name, c.status,
      count(r.id)::int AS recipients,
      count(*) FILTER (WHERE r.sent_at IS NOT NULL)::int AS sent,
      count(*) FILTER (WHERE r.delivered_at IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE r.opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE r.clicked_at IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE r.replied_at IS NOT NULL)::int AS replied
      FROM campaigns c LEFT JOIN recipients r ON r.campaign_id = c.id
      GROUP BY c.id, c.name, c.status, c.created_at ORDER BY c.created_at DESC`;
    return rows.map((r) => ({
      id: r.id as string, name: r.name as string, status: r.status as Campaign["status"],
      recipientCount: (r.recipients as number) || 0, recipients: (r.recipients as number) || 0,
      sent: (r.sent as number) || 0, delivered: (r.delivered as number) || 0, opened: (r.opened as number) || 0,
      clicked: (r.clicked as number) || 0, replied: (r.replied as number) || 0,
    }));
  }
  async templatePerformance() {
    const sql = await this.db();
    // Aggregated in SQL (tiny result set). Opens/replies attributed to the first-mail template.
    const rows = await sql`SELECT c.template_id AS id,
      count(DISTINCT c.id)::int AS campaigns,
      count(*) FILTER (WHERE r.sent_at IS NOT NULL)::int AS sent,
      count(*) FILTER (WHERE r.opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE r.clicked_at IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE r.replied_at IS NOT NULL)::int AS replied
      FROM campaigns c LEFT JOIN recipients r ON r.campaign_id = c.id
      GROUP BY c.template_id`;
    return rows.map((r) => ({
      id: r.id as string, campaigns: (r.campaigns as number) || 0, sent: (r.sent as number) || 0,
      opened: (r.opened as number) || 0, clicked: (r.clicked as number) || 0, replied: (r.replied as number) || 0,
    }));
  }
  async createList(name: string, prospectIds: string[], source: string) {
    const sql = await this.db();
    const existing = await sql`SELECT * FROM lists WHERE name=${name}`;
    let id: string;
    let createdAt: string;
    if (existing.length) {
      id = existing[0].id;
      createdAt = new Date(existing[0].created_at).toISOString();
    } else {
      id = uuid();
      await sql`INSERT INTO lists (id,name,source,created_at) VALUES (${id},${name},${source},now())`;
      createdAt = new Date().toISOString();
    }
    if (prospectIds.length) {
      await sql`INSERT INTO list_members (list_id, prospect_id)
        SELECT ${id}, x FROM unnest(${prospectIds}::text[]) AS x
        ON CONFLICT DO NOTHING`;
    }
    const c = await sql`SELECT count(*)::int n FROM list_members WHERE list_id=${id}`;
    return { id, name, source, count: c[0].n, createdAt } as List;
  }
  async getLists() {
    const sql = await this.db();
    const rows = await sql`SELECT l.*, (SELECT count(*)::int FROM list_members m WHERE m.list_id=l.id) AS cnt FROM lists l ORDER BY created_at DESC`;
    return rows.map((r) => ({ id: r.id, name: r.name, source: r.source, count: r.cnt, createdAt: new Date(r.created_at).toISOString() })) as List[];
  }
  async getList(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT l.*, (SELECT count(*)::int FROM list_members m WHERE m.list_id=l.id) AS cnt FROM lists l WHERE l.id=${id}`;
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.name, source: r.source, count: r.cnt, createdAt: new Date(r.created_at).toISOString() } as List;
  }
  async getListMembers(listId: string) {
    const sql = await this.db();
    const rows = await sql`SELECT p.* FROM prospects p JOIN list_members m ON m.prospect_id=p.id WHERE m.list_id=${listId} ORDER BY p.name`;
    return rows.map((r) => this.mapProspect(r));
  }
  async addToList(listId: string, prospectIds: string[]) {
    if (!prospectIds.length) return;
    const sql = await this.db();
    await sql`INSERT INTO list_members (list_id, prospect_id)
      SELECT ${listId}, x FROM unnest(${prospectIds}::text[]) AS x
      ON CONFLICT DO NOTHING`;
  }
  async removeFromList(listId: string, prospectId: string) {
    const sql = await this.db();
    await sql`DELETE FROM list_members WHERE list_id=${listId} AND prospect_id=${prospectId}`;
  }
  async deleteList(id: string) {
    const sql = await this.db();
    await sql`DELETE FROM list_members WHERE list_id=${id}`;
    await sql`DELETE FROM lists WHERE id=${id}`;
  }
  async updateProspect(id: string, patch: Partial<Prospect>) {
    const sql = await this.db();
    const rows = await sql`UPDATE prospects SET
      name=COALESCE(${patch.name ?? null}, name),
      company=COALESCE(${patch.company ?? null}, company),
      email=COALESCE(${patch.email ?? null}, email),
      title=COALESCE(${patch.title ?? null}, title),
      email_status=COALESCE(${patch.emailStatus ?? null}, email_status),
      website=COALESCE(${patch.website ?? null}, website)
      WHERE id=${id} RETURNING *`;
    return rows.length ? this.mapProspect(rows[0]) : null;
  }
  private mapAudit(r: Record<string, unknown>): AuditRecord {
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      website: r.website as string,
      host: (r.host as string) || "",
      status: (r.status as AuditRecord["status"]) || "failed",
      seoScore: num(r.seo_score), geoScore: num(r.geo_score), geoPageScore: num(r.geo_page_score),
      seoBand: (r.seo_band as string) || "", geoBand: (r.geo_band as string) || "",
      auditId: (r.audit_id as string) || "", reportUrl: (r.report_url as string) || "",
      topIssue: (r.top_issue as string) || "", topFix: (r.top_fix as string) || "",
      error: (r.error as string) || "",
      checkedAt: new Date(r.checked_at as string).toISOString(),
    };
  }
  async getAuditsByWebsites(websites: string[]) {
    const out = new Map<string, AuditRecord>();
    if (!websites.length) return out;
    const sql = await this.db();
    const rows = await sql`SELECT * FROM audits WHERE website = ANY(${websites}::text[])`;
    for (const r of rows) {
      const a = this.mapAudit(r);
      out.set(a.website, a);
    }
    return out;
  }
  async upsertAudits(rows: AuditRecord[]) {
    if (!rows.length) return;
    const sql = await this.db();
    const col = <T>(f: (a: AuditRecord) => T) => rows.map(f);
    // Re-auditing a site overwrites its row: the newest score is the only one
    // that may reach an email.
    await sql`
      INSERT INTO audits (website,host,status,seo_score,geo_score,geo_page_score,seo_band,geo_band,audit_id,report_url,top_issue,top_fix,error,checked_at)
      SELECT t.website,t.host,t.status,t.seo_score,t.geo_score,t.geo_page_score,t.seo_band,t.geo_band,t.audit_id,t.report_url,t.top_issue,t.top_fix,t.error,now()
      FROM unnest(
        ${col((a) => a.website)}::text[], ${col((a) => a.host)}::text[], ${col((a) => a.status)}::text[],
        ${col((a) => a.seoScore)}::int[], ${col((a) => a.geoScore)}::int[], ${col((a) => a.geoPageScore)}::int[],
        ${col((a) => a.seoBand)}::text[], ${col((a) => a.geoBand)}::text[], ${col((a) => a.auditId)}::text[],
        ${col((a) => a.reportUrl)}::text[], ${col((a) => a.topIssue)}::text[], ${col((a) => a.topFix)}::text[],
        ${col((a) => a.error)}::text[]
      ) AS t(website,host,status,seo_score,geo_score,geo_page_score,seo_band,geo_band,audit_id,report_url,top_issue,top_fix,error)
      ON CONFLICT (website) DO UPDATE SET
        host=EXCLUDED.host, status=EXCLUDED.status, seo_score=EXCLUDED.seo_score,
        geo_score=EXCLUDED.geo_score, geo_page_score=EXCLUDED.geo_page_score,
        seo_band=EXCLUDED.seo_band, geo_band=EXCLUDED.geo_band, audit_id=EXCLUDED.audit_id,
        report_url=EXCLUDED.report_url, top_issue=EXCLUDED.top_issue, top_fix=EXCLUDED.top_fix,
        error=EXCLUDED.error, checked_at=now()`;
  }
  async listAudits(limit = 500) {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM audits ORDER BY checked_at DESC LIMIT ${limit}`;
    return rows.map((r) => this.mapAudit(r));
  }
  async sentTodayCount() {
    const sql = await this.db();
    const rows = await sql`SELECT
      (SELECT count(*)::int FROM recipients WHERE sent_at::date = current_date)
      + (SELECT count(*)::int FROM recipients WHERE followup_sent_at::date = current_date) AS n`;
    return (rows[0]?.n as number) || 0;
  }
  async sentTodayByMailbox(mailbox: string | null) {
    const sql = await this.db();
    const rows = await sql`
      SELECT count(*)::int AS n FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE c.from_mailbox IS NOT DISTINCT FROM ${mailbox}
        AND (r.sent_at::date = current_date OR r.followup_sent_at::date = current_date OR r.followup2_sent_at::date = current_date)`;
    return (rows[0]?.n as number) || 0;
  }
  private mapReq(r: Record<string, unknown>): SourcingRequest {
    return {
      id: r.id as string,
      filters: JSON.parse((r.filters as string) || "{}"),
      status: (r.status as SourcingRequest["status"]) || "pending",
      note: (r.note as string) || "",
      resultListId: (r.result_list_id as string) || null,
      importedCount: (r.imported_count as number) || 0,
      createdAt: new Date(r.created_at as string).toISOString(),
      fulfilledAt: r.fulfilled_at ? new Date(r.fulfilled_at as string).toISOString() : null,
    };
  }
  async createSourcingRequest(filters: SearchFilters) {
    const sql = await this.db();
    const id = uuid();
    await sql`INSERT INTO sourcing_requests (id, filters, status, created_at) VALUES (${id}, ${JSON.stringify(filters)}, 'pending', now())`;
    return { id, filters, status: "pending", note: "", resultListId: null, importedCount: 0, createdAt: new Date().toISOString(), fulfilledAt: null } as SourcingRequest;
  }
  async listSourcingRequests() {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM sourcing_requests ORDER BY created_at DESC LIMIT 200`;
    return rows.map((r) => this.mapReq(r));
  }
  async getSourcingRequest(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM sourcing_requests WHERE id=${id}`;
    return rows.length ? this.mapReq(rows[0]) : null;
  }
  async fulfillSourcingRequest(id: string, info: { resultListId: string | null; importedCount: number; note: string; status?: SourcingRequest["status"] }) {
    const sql = await this.db();
    await sql`UPDATE sourcing_requests SET status=${info.status ?? "fulfilled"}, result_list_id=${info.resultListId}, imported_count=${info.importedCount}, note=${info.note}, fulfilled_at=now() WHERE id=${id}`;
  }
}

let _store: Store | null = null;
export function getStore(): Store {
  if (_store) return _store;
  const url = process.env.DATABASE_URL;
  _store = url && /^postgres/.test(url) ? new PgStore() : new MemoryStore();
  return _store;
}
