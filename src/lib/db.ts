import { v4 as uuid } from "uuid";
import type { Prospect, Template, Campaign, Recipient, RecipientStatus, List, SourcingRequest, SearchFilters, Attachment } from "./types";

/* ============================================================
   Storage abstraction.
   - If DATABASE_URL (postgres) is set -> Neon Postgres backend.
   - Otherwise -> in-memory store seeded with demo data.
   Both implement the same async Store interface.
   ============================================================ */

export interface Store {
  listProspects(): Promise<Prospect[]>;
  saveProspects(p: Prospect[]): Promise<Prospect[]>;
  getTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | null>;
  saveTemplate(t: Omit<Template, "updatedAt"> & { id?: string }): Promise<Template>;
  deleteTemplate(id: string): Promise<void>;
  getCampaigns(): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | null>;
  createCampaign(name: string, templateId: string, prospectIds: string[], followupTemplateId?: string | null, followupDays?: number, scheduledAt?: string | null, attachments?: Attachment[]): Promise<Campaign>;
  setCampaignStatus(id: string, status: Campaign["status"]): Promise<void>;
  deleteCampaign(id: string): Promise<void>;
  dueScheduledCampaigns(): Promise<Campaign[]>;
  getRecipients(campaignId: string): Promise<Recipient[]>;
  getRecipient(id: string): Promise<Recipient | null>;
  markSent(recipientId: string): Promise<void>;
  markFollowupSent(recipientId: string): Promise<void>;
  deleteRecipients(campaignId: string, ids: string[]): Promise<number>;
  recordEvent(recipientId: string, type: "delivered" | "opened" | "clicked" | "replied" | "bounced"): Promise<void>;
  allRecipients(): Promise<Recipient[]>;
  dueFollowups(): Promise<{ campaign: Campaign; recipient: Recipient }[]>;
  createList(name: string, prospectIds: string[], source: string): Promise<List>;
  getLists(): Promise<List[]>;
  getList(id: string): Promise<List | null>;
  getListMembers(listId: string): Promise<Prospect[]>;
  addToList(listId: string, prospectIds: string[]): Promise<void>;
  removeFromList(listId: string, prospectId: string): Promise<void>;
  deleteList(id: string): Promise<void>;
  updateProspect(id: string, patch: Partial<Prospect>): Promise<Prospect | null>;
  sentTodayCount(): Promise<number>;
  createSourcingRequest(filters: SearchFilters): Promise<SourcingRequest>;
  listSourcingRequests(): Promise<SourcingRequest[]>;
  getSourcingRequest(id: string): Promise<SourcingRequest | null>;
  fulfillSourcingRequest(id: string, info: { resultListId: string | null; importedCount: number; note: string; status?: SourcingRequest["status"] }): Promise<void>;
}

const DEFAULT_TEMPLATE_BODY = `Hi {{first_name}},

I came across {{company}} and was impressed by what you're building in the {{city}} market. As the {{title}}, you're probably juggling growth and a hundred other things.

We help founders like you [your value prop in one line]. Companies your size typically see [specific outcome] within the first 90 days.

Worth a quick 15-minute call next week to see if it's a fit?

Best,
Bithindra`;

/* ---------------- In-memory backend ---------------- */
class MemoryStore implements Store {
  prospects: Prospect[] = [];
  templates: Template[] = [];
  campaigns: Campaign[] = [];
  recipients: Recipient[] = [];
  sourcingRequests: SourcingRequest[] = [];
  lists: List[] = [];
  listMembers: { listId: string; prospectId: string }[] = [];

  constructor() {
    this.seed();
  }

  private seed() {
    const now = Date.now();
    const tmpl: Template = {
      id: uuid(),
      name: "Founder Cold Intro",
      subject: "Quick idea for {{company}}",
      body: DEFAULT_TEMPLATE_BODY,
      updatedAt: new Date().toISOString(),
    };
    this.templates.push(tmpl);

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
      status: "sent",
      scheduledAt: null,
      createdAt: new Date(now - 1000 * 60 * 60 * 72).toISOString(),
      recipientCount: this.prospects.length,
      attachments: [],
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
  async getTemplates() {
    return [...this.templates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getTemplate(id: string) {
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async saveTemplate(t: Omit<Template, "updatedAt"> & { id?: string }) {
    const existing = t.id ? this.templates.find((x) => x.id === t.id) : null;
    if (existing) {
      existing.name = t.name;
      existing.subject = t.subject;
      existing.body = t.body;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    const created: Template = { id: t.id || uuid(), name: t.name, subject: t.subject, body: t.body, updatedAt: new Date().toISOString() };
    this.templates.push(created);
    return created;
  }
  async deleteTemplate(id: string) {
    this.templates = this.templates.filter((t) => t.id !== id);
  }
  async getCampaigns() {
    return [...this.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getCampaign(id: string) {
    return this.campaigns.find((c) => c.id === id) ?? null;
  }
  async createCampaign(name: string, templateId: string, prospectIds: string[], followupTemplateId: string | null = null, followupDays = 7, scheduledAt: string | null = null, attachments: Attachment[] = []) {
    const camp: Campaign = { id: uuid(), name, templateId, followupTemplateId, followupDays, status: scheduledAt ? "scheduled" : "draft", scheduledAt, createdAt: new Date().toISOString(), recipientCount: prospectIds.length, attachments };
    this.campaigns.push(camp);
    for (const pid of prospectIds) {
      const p = this.prospects.find((x) => x.id === pid);
      if (!p) continue;
      this.recipients.push({
        id: uuid(), campaignId: camp.id, prospectId: p.id, name: p.name, email: p.email, company: p.company,
        status: "queued", sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null, repliedAt: null, followupSentAt: null, opens: 0, clicks: 0,
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
        if (["replied", "bounced", "queued"].includes(r.status)) continue;
        if (now - new Date(r.sentAt).getTime() >= c.followupDays * 86400000) out.push({ campaign: c, recipient: r });
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
    if (type === "bounced") { r.status = "bounced"; return; }
    if ((rank[type] ?? 0) >= (rank[r.status] ?? 0)) r.status = type as RecipientStatus;
  }
  async allRecipients() {
    return [...this.recipients];
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
  async sentTodayCount() {
    const today = new Date().toDateString();
    return this.recipients.filter((r) => (r.sentAt && new Date(r.sentAt).toDateString() === today))
      .length + this.recipients.filter((r) => r.followupSentAt && new Date(r.followupSentAt).toDateString() === today).length;
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
    await sql`CREATE TABLE IF NOT EXISTS campaigns (
      id text PRIMARY KEY, name text, template_id text, status text, created_at timestamptz DEFAULT now())`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup_template_id text`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup_days int DEFAULT 7`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz`;
    await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attachments text`;
    await sql`CREATE TABLE IF NOT EXISTS recipients (
      id text PRIMARY KEY, campaign_id text, prospect_id text, name text, email text, company text,
      status text, sent_at timestamptz, delivered_at timestamptz, opened_at timestamptz,
      clicked_at timestamptz, replied_at timestamptz, opens int DEFAULT 0, clicks int DEFAULT 0)`;
    await sql`ALTER TABLE recipients ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz`;
    await sql`CREATE TABLE IF NOT EXISTS sourcing_requests (
      id text PRIMARY KEY, filters text, status text DEFAULT 'pending', note text DEFAULT '',
      result_list_id text, imported_count int DEFAULT 0, created_at timestamptz DEFAULT now(), fulfilled_at timestamptz)`;
    await sql`CREATE TABLE IF NOT EXISTS lists (
      id text PRIMARY KEY, name text UNIQUE, source text, created_at timestamptz DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS list_members (
      list_id text, prospect_id text, PRIMARY KEY (list_id, prospect_id))`;
    const t = await sql`SELECT count(*)::int AS n FROM templates`;
    if (t[0].n === 0) {
      await sql`INSERT INTO templates (id, name, subject, body, updated_at)
        VALUES (${uuid()}, ${"Founder Cold Intro"}, ${"Quick idea for {{company}}"}, ${DEFAULT_TEMPLATE_BODY}, now())`;
    }
  }

  private mapProspect(r: Record<string, unknown>): Prospect {
    return {
      id: r.id as string, name: r.name as string, title: r.title as string, company: r.company as string,
      companySize: r.company_size as string, industry: r.industry as string, country: r.country as string,
      city: r.city as string, linkedin: r.linkedin as string, email: (r.email as string) || "",
      emailStatus: (r.email_status as Prospect["emailStatus"]) || "unknown",
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
      opens: (r.opens as number) || 0, clicks: (r.clicks as number) || 0,
    };
  }
  private mapCampaign(r: Record<string, unknown>): Campaign {
    return {
      id: r.id as string, name: r.name as string, templateId: r.template_id as string,
      followupTemplateId: (r.followup_template_id as string) || null,
      followupDays: (r.followup_days as number) ?? 7,
      status: r.status as Campaign["status"],
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at as string).toISOString() : null,
      createdAt: new Date(r.created_at as string).toISOString(),
      recipientCount: (r.rc as number) ?? 0,
      attachments: r.attachments ? (JSON.parse(r.attachments as string) as Attachment[]) : [],
    };
  }

  async listProspects() {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM prospects ORDER BY created_at DESC LIMIT 1000`;
    return rows.map((r) => this.mapProspect(r));
  }
  async saveProspects(incoming: Prospect[]) {
    const sql = await this.db();
    const added: Prospect[] = [];
    for (const p of incoming) {
      const res = await sql`INSERT INTO prospects (id,name,title,company,company_size,industry,country,city,linkedin,email,email_status,created_at)
        VALUES (${p.id},${p.name},${p.title},${p.company},${p.companySize},${p.industry},${p.country},${p.city},${p.linkedin},${p.email || null},${p.emailStatus},now())
        ON CONFLICT (email) DO NOTHING RETURNING *`;
      if (res.length) added.push(this.mapProspect(res[0]));
    }
    return added;
  }
  async getTemplates() {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM templates ORDER BY updated_at DESC`;
    return rows.map((r) => ({ id: r.id, name: r.name, subject: r.subject, body: r.body, updatedAt: new Date(r.updated_at).toISOString() })) as Template[];
  }
  async getTemplate(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM templates WHERE id=${id}`;
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.name, subject: r.subject, body: r.body, updatedAt: new Date(r.updated_at).toISOString() } as Template;
  }
  async saveTemplate(t: Omit<Template, "updatedAt"> & { id?: string }) {
    const sql = await this.db();
    if (t.id) {
      const upd = await sql`UPDATE templates SET name=${t.name}, subject=${t.subject}, body=${t.body}, updated_at=now() WHERE id=${t.id} RETURNING *`;
      if (upd.length) { const r = upd[0]; return { id: r.id, name: r.name, subject: r.subject, body: r.body, updatedAt: new Date(r.updated_at).toISOString() } as Template; }
    }
    const id = t.id || uuid();
    const ins = await sql`INSERT INTO templates (id,name,subject,body,updated_at) VALUES (${id},${t.name},${t.subject},${t.body},now()) RETURNING *`;
    const r = ins[0];
    return { id: r.id, name: r.name, subject: r.subject, body: r.body, updatedAt: new Date(r.updated_at).toISOString() } as Template;
  }
  async deleteTemplate(id: string) {
    const sql = await this.db();
    await sql`DELETE FROM templates WHERE id=${id}`;
  }
  async getCampaigns() {
    const sql = await this.db();
    const rows = await sql`SELECT c.*, (SELECT count(*)::int FROM recipients r WHERE r.campaign_id=c.id) AS rc FROM campaigns c ORDER BY created_at DESC`;
    return rows.map((r) => this.mapCampaign(r));
  }
  async getCampaign(id: string) {
    const sql = await this.db();
    const rows = await sql`SELECT c.*, (SELECT count(*)::int FROM recipients r WHERE r.campaign_id=c.id) AS rc FROM campaigns c WHERE c.id=${id}`;
    if (!rows.length) return null;
    return this.mapCampaign(rows[0]);
  }
  async createCampaign(name: string, templateId: string, prospectIds: string[], followupTemplateId: string | null = null, followupDays = 7, scheduledAt: string | null = null, attachments: Attachment[] = []) {
    const sql = await this.db();
    const id = uuid();
    const status = scheduledAt ? "scheduled" : "draft";
    const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;
    await sql`INSERT INTO campaigns (id,name,template_id,followup_template_id,followup_days,status,scheduled_at,attachments,created_at)
      VALUES (${id},${name},${templateId},${followupTemplateId},${followupDays},${status},${scheduledAt},${attachmentsJson},now())`;
    // Bulk-insert all recipients in a single round-trip. Inserting one row per
    // prospect (as before) meant ~2 network calls × N prospects to Neon — a
    // 40-prospect list took ~18s and made the UI look frozen. This is one query.
    if (prospectIds.length) {
      await sql`INSERT INTO recipients (id,campaign_id,prospect_id,name,email,company,status,opens,clicks)
        SELECT gen_random_uuid()::text, ${id}, p.id, p.name, p.email, p.company, 'queued', 0, 0
        FROM prospects p WHERE p.id = ANY(${prospectIds})`;
    }
    return { id, name, templateId, followupTemplateId, followupDays, status, scheduledAt, createdAt: new Date().toISOString(), recipientCount: prospectIds.length, attachments } as Campaign;
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
    const rows = await sql`SELECT c.*, (SELECT count(*)::int FROM recipients r WHERE r.campaign_id=c.id) AS rc
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
             c.status AS c_status, c.created_at AS c_created_at, c.attachments AS c_attachments
      FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE c.followup_template_id IS NOT NULL
        AND r.followup_sent_at IS NULL
        AND r.sent_at IS NOT NULL
        AND r.status NOT IN ('replied','bounced','queued')
        AND r.sent_at <= now() - (c.followup_days * INTERVAL '1 day')`;
    return rows.map((r) => ({
      campaign: this.mapCampaign({ id: r.c_id, name: r.c_name, template_id: r.c_template_id, followup_template_id: r.c_followup_template_id, followup_days: r.c_followup_days, status: r.c_status, created_at: r.c_created_at, attachments: r.c_attachments }),
      recipient: this.mapRecipient(r),
    }));
  }
  async recordEvent(recipientId: string, type: "delivered" | "opened" | "clicked" | "replied" | "bounced") {
    const sql = await this.db();
    if (type === "delivered") await sql`UPDATE recipients SET delivered_at=COALESCE(delivered_at,now()), status=CASE WHEN status IN ('queued','sent') THEN 'delivered' ELSE status END WHERE id=${recipientId}`;
    if (type === "opened") await sql`UPDATE recipients SET opened_at=COALESCE(opened_at,now()), opens=opens+1, status=CASE WHEN status IN ('queued','sent','delivered') THEN 'opened' ELSE status END WHERE id=${recipientId}`;
    if (type === "clicked") await sql`UPDATE recipients SET clicked_at=COALESCE(clicked_at,now()), clicks=clicks+1, status=CASE WHEN status IN ('queued','sent','delivered','opened') THEN 'clicked' ELSE status END WHERE id=${recipientId}`;
    if (type === "replied") await sql`UPDATE recipients SET replied_at=COALESCE(replied_at,now()), status='replied' WHERE id=${recipientId}`;
    if (type === "bounced") await sql`UPDATE recipients SET status='bounced' WHERE id=${recipientId}`;
  }
  async allRecipients() {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM recipients`;
    return rows.map((r) => this.mapRecipient(r));
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
    for (const pid of prospectIds) {
      await sql`INSERT INTO list_members (list_id,prospect_id) VALUES (${id},${pid}) ON CONFLICT DO NOTHING`;
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
    const sql = await this.db();
    for (const pid of prospectIds) {
      await sql`INSERT INTO list_members (list_id,prospect_id) VALUES (${listId},${pid}) ON CONFLICT DO NOTHING`;
    }
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
      email_status=COALESCE(${patch.emailStatus ?? null}, email_status)
      WHERE id=${id} RETURNING *`;
    return rows.length ? this.mapProspect(rows[0]) : null;
  }
  async sentTodayCount() {
    const sql = await this.db();
    const rows = await sql`SELECT
      (SELECT count(*)::int FROM recipients WHERE sent_at::date = current_date)
      + (SELECT count(*)::int FROM recipients WHERE followup_sent_at::date = current_date) AS n`;
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
