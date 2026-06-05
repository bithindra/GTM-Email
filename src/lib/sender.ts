import { v4 as uuid } from "uuid";
import { getStore, type Store } from "./db";
import { renderBodyHtml, mergeDataFromProspect, renderTemplate, sendEmail } from "./email";
import { searchProspects, enrichPeople } from "./apollo";
import { scanInbox } from "./inbox";
import type { Prospect } from "./types";

// Auto-fulfill any pending sourcing requests via Apollo (search → reveal emails →
// save as list). Runs in-app on the dispatcher — no Claude, no Explorium.
export async function processApolloRequests(store: Store) {
  if (!process.env.APOLLO_API_KEY) return { handled: 0, fulfilled: 0, creditsUsed: 0 };
  const pending = (await store.listSourcingRequests()).filter((r) => r.status === "pending");
  let handled = 0, fulfilled = 0, creditsUsed = 0;

  for (const req of pending) {
    handled++;
    const { source, prospects } = await searchProspects(req.filters);
    if (source !== "apollo") continue; // no key/mock — leave pending
    if (!prospects.length) {
      await store.fulfillSourcingRequest(req.id, { resultListId: null, importedCount: 0, note: "No Apollo matches.", status: "rejected" });
      continue;
    }
    // Honor the requested pull size (each reveal = 1 Apollo credit). Capped at 1000.
    const cap = Math.min(prospects.length, req.filters.limit || 25, 1000);
    const capped = prospects.slice(0, cap);
    const revealed = await enrichPeople(capped.map((p) => ({
      apolloId: p.apolloId, firstName: p.firstName, lastName: p.lastName, name: p.name, domain: p.domain, linkedin: p.linkedin, company: p.company,
    })));
    const incoming: Prospect[] = capped.map((p, i) => {
      const rev = revealed.get(p.apolloId || `idx_${i}`);
      const email = (rev?.email || p.email || "").toLowerCase();
      if (rev?.email) creditsUsed++;
      const emailStatus: Prospect["emailStatus"] = rev?.status === "verified" ? "verified" : email ? "guessed" : "unknown";
      return { ...p, id: uuid(), name: rev?.name || p.name, linkedin: rev?.linkedin || p.linkedin, email, emailStatus, createdAt: new Date().toISOString() };
    }).filter((p) => p.email);

    if (!incoming.length) {
      await store.fulfillSourcingRequest(req.id, { resultListId: null, importedCount: 0, note: "Matches found but no emails revealable.", status: "rejected" });
      continue;
    }
    await store.saveProspects(incoming);
    const byEmail = await store.getProspectIdsByEmails(incoming.map((p) => p.email));
    const ids = incoming.map((p) => byEmail.get(p.email.toLowerCase())).filter((x): x is string => !!x);
    const f = req.filters;
    const name = `${(f.titles || []).slice(0, 2).join("/") || "Leads"} · ${(f.countries || []).join(", ")} · ${new Date().toLocaleDateString()}`;
    const list = await store.createList(name, ids, "apollo-auto");
    await store.fulfillSourcingRequest(req.id, { resultListId: list.id, importedCount: incoming.length, note: `Auto-pulled ${incoming.length} via Apollo (${creditsUsed} credits).`, status: "fulfilled" });
    fulfilled++;
  }
  return { handled, fulfilled, creditsUsed };
}

export function dailyLimit(): number {
  return Number(process.env.SEND_DAILY_LIMIT || 400);
}

// One dispatch pass: send due scheduled campaigns, then due follow-ups, under the daily cap.
// Safe to call from a cron or an on-app-load tick — only already-due work is sent.
export async function runDispatch(store: Store = getStore()) {
  const limit = dailyLimit();
  let budget = Math.max(0, limit - (await store.sentTodayCount()));
  const scheduled: { id: string; name: string; sent: number; throttled: number }[] = [];
  const due = await store.dueScheduledCampaigns();
  for (const c of due) {
    if (budget <= 0) break;
    const r = await sendCampaignQueued(store, c.id, budget);
    budget = r.budgetLeft;
    scheduled.push({ id: c.id, name: c.name, sent: r.sent, throttled: r.throttled });
  }
  const fu = await processFollowups(store, budget);
  const apollo = await processApolloRequests(store);
  let inbox;
  try { inbox = await scanInbox(store); } catch { /* non-fatal */ }
  return { dailyLimit: limit, scheduled, followups: { due: fu.due, sent: fu.sent, throttled: fu.throttled }, apollo, inbox };
}

export type SendStats = { sent: number; failed: number; simulated: boolean; throttled: number };

// Send all queued recipients of a campaign, up to `budget` emails.
// Returns stats and the budget left.
export async function sendCampaignQueued(
  store: Store,
  campaignId: string,
  budget: number,
): Promise<SendStats & { budgetLeft: number }> {
  const stats: SendStats = { sent: 0, failed: 0, simulated: false, throttled: 0 };
  const campaign = await store.getCampaign(campaignId);
  if (!campaign) return { ...stats, budgetLeft: budget };
  const template = await store.getTemplate(campaign.templateId);
  if (!template) return { ...stats, budgetLeft: budget };

  await store.setCampaignStatus(campaignId, "sending");
  const recipients = await store.getRecipients(campaignId);
  const prospects = await store.listProspects();
  const pIndex = new Map(prospects.map((p) => [p.id, p]));

  let left = budget;
  for (const r of recipients) {
    if (r.status !== "queued") continue;
    if (left <= 0) { stats.throttled++; continue; }
    const p = pIndex.get(r.prospectId);
    const data = mergeDataFromProspect(p ?? { name: r.name, company: r.company, title: "", city: "", country: "" });
    const subject = renderTemplate(template.subject, data);
    const html = renderBodyHtml(template.type, renderTemplate(template.body, data), r.id);
    const res = await sendEmail({ to: r.email, subject, html, attachments: campaign.attachments });
    if (res.ok) {
      stats.simulated = stats.simulated || res.simulated;
      await store.markSent(r.id);
      // A successful SMTP/Resend send is accepted by the mail server = delivered.
      // (Hard bounces throw and land in the catch below.) Gmail SMTP has no webhook,
      // so we record delivery here rather than waiting for one.
      await store.recordEvent(r.id, "delivered");
      stats.sent++;
      left--;
    } else {
      stats.failed++;
    }
  }
  await store.setCampaignStatus(campaignId, stats.throttled > 0 ? "sending" : "sent");
  return { ...stats, budgetLeft: left };
}

// Send due follow-ups across all campaigns, up to `budget` emails.
export async function processFollowups(
  store: Store,
  budget: number,
): Promise<SendStats & { due: number; budgetLeft: number }> {
  const stats: SendStats = { sent: 0, failed: 0, simulated: false, throttled: 0 };
  const due = await store.dueFollowups();
  const prospects = await store.listProspects();
  const pIndex = new Map(prospects.map((p) => [p.id, p]));
  const templates = new Map((await store.getTemplates()).map((t) => [t.id, t]));

  let left = budget;
  for (const { campaign, recipient } of due) {
    if (left <= 0) { stats.throttled++; continue; }
    const tmpl = campaign.followupTemplateId ? templates.get(campaign.followupTemplateId) : null;
    if (!tmpl) continue;
    const p = pIndex.get(recipient.prospectId);
    const data = mergeDataFromProspect(p ?? { name: recipient.name, company: recipient.company, title: "", city: "", country: "" });
    const html = renderBodyHtml(tmpl.type, renderTemplate(tmpl.body, data), recipient.id);
    const res = await sendEmail({ to: recipient.email, subject: renderTemplate(tmpl.subject, data), html, attachments: campaign.attachments });
    if (res.ok) {
      stats.simulated = stats.simulated || res.simulated;
      await store.markFollowupSent(recipient.id);
      stats.sent++;
      left--;
    } else {
      stats.failed++;
    }
  }
  return { ...stats, due: due.length, budgetLeft: left };
}
