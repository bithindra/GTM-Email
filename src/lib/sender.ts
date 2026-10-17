import { v4 as uuid } from "uuid";
import { getStore, type Store } from "./db";
import { renderBodyHtml, mergeDataFromProspect, renderTemplate, sendEmail, closeTransports, spin, formatOf, trackOf, hasUnresolvedMerge, isPersonal, withOptOut } from "./email";
import { resolveMailbox } from "./mailboxes";
import { searchProspects, enrichPeople } from "./apollo";
import { validateAddress } from "./emailcheck";
import { scanInbox } from "./inbox";
import type { Campaign, Prospect } from "./types";
import { anySendWindowOpen, withinSendWindow } from "./send-window";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drip, don't blast. After each real send we wait a randomized gap so a campaign goes
// out as a human-paced series over several minutes rather than all at once — back-to-back
// bursts are a classic spam signal. Tunable via SEND_PACE_MIN_MS / SEND_PACE_MAX_MS.
async function pace(simulated: boolean, via?: "ses" | "direct") {
  if (simulated) return;
  // Amazon SES takes 14 mails a second, so the human-cadence gap matters less there —
  // a shorter one lets a run's 240 s budget carry ~3x the mail. A mailbox's own SMTP
  // (Hostinger, Gmail) keeps the slower cadence.
  const ses = via === "ses";
  const a = Number((ses ? process.env.SES_PACE_MIN_MS : process.env.SEND_PACE_MIN_MS) || (ses ? 1000 : 3000));
  const b = Number((ses ? process.env.SES_PACE_MAX_MS : process.env.SEND_PACE_MAX_MS) || (ses ? 2500 : 9000));
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.max(a, b);
  await sleep(lo + Math.floor(Math.random() * (hi - lo + 1)));
}

/**
 * The Amazon SES account is XamBaaz's — its student mail runs through it first. AWS
 * reviews or pauses an account whose bounces pass ~5% (complaints 0.1%), and cold lists
 * bounce more than opted-in ones. So a mailbox stops using SES on its own once its
 * last 7 days bounce over SES_BOUNCE_GUARD (default 3%, judged after 40 sends) and goes
 * back to its own SMTP; SES resumes when the rate falls. Cached per dispatch run.
 */
export function bounceGuardTripped(sent: number, bounced: number): boolean {
  const limit = Number(process.env.SES_BOUNCE_GUARD || 0.03);
  return sent >= 40 && bounced / sent > limit;
}
async function relayAllowed(store: Store, mailboxId: string | null, cache: Map<string, boolean>): Promise<boolean> {
  const key = mailboxId ?? "";
  if (cache.has(key)) return cache.get(key)!;
  let ok = true;
  if (resolveMailbox(mailboxId)?.relay) {
    const { sent, bounced } = await store.bounceStatsByMailbox(mailboxId, 7);
    ok = !bounceGuardTripped(sent, bounced);
    if (!ok) console.warn(`[send] SES bounce guard: ${mailboxId} bounced ${bounced}/${sent} in 7 days — sending directly`);
  }
  cache.set(key, ok);
  return ok;
}

// Only these mean "this ADDRESS is permanently invalid" → mark bounced + suppress.
// Be conservative: a generic 550 is NOT enough (Gmail returns 550 for quota, policy,
// rate-limit and size too). We require an explicit no-such-recipient signal.
const PERMANENT_SEND_ERROR =
  /5\.1\.[01]\b|5\.0\.0\b|no such (?:user|mailbox|recipient)|user unknown|unknown user|does ?n['’]?t exist|does not exist|mailbox (?:not found|unavailable|disabled|does not exist)|address (?:rejected|not found)|recipient (?:rejected|not found)|invalid recipient|no mailbox|account that you tried to reach does not exist/i;

// Temporary failures — quota, rate-limit, throttle, reputation block, greylist, size,
// network. Keep the recipient queued and retry next dispatch; NEVER suppress. Checked
// FIRST so it overrides any incidental permanent-looking text.
const TRANSIENT_SEND_ERROR =
  /\b4\.\d\.\d\b|\b421\b|\b45\d\b|5\.4\.5|5\.7\.\d|daily .*(?:limit|quota)|sending limit|quota|rate ?limit|too many|try again|temporar|throttl|greylist|defer|blocked|spam|reputation|5\.2\.3|\b552\b|message too large|too large|timeout|ETIMEDOUT|ECONNRESET|ESOCKET|EAI_AGAIN|ECONNECTION/i;

// A subset that is an account-level wall (daily/rate limit). When we hit this there's
// no point trying the rest of the batch this run — stop and leave them queued.
// Hostinger words it `451 4.7.1 Ratelimit "hostinger_out_ratelimit" exceeded for key …`,
// with the limit's name between "Ratelimit" and "exceeded".
export const MAILBOX_LIMIT_ERROR =
  /5\.4\.5|daily .*(?:limit|quota)|sending limit|quota exceeded|rate ?limit\b.{0,60}\bexceeded|too many (?:messages|recipients|login)/i;

// Wall-clock budget per dispatch invocation. Stop sending before the serverless
// function times out; whatever is left stays queued and the next tick continues.
function sendDeadline(): number {
  return Date.now() + Number(process.env.DISPATCH_TIME_BUDGET_MS || 240_000);
}

// The send-window guard lives in ./send-window (shared with the campaign form).
// Re-exported so existing imports (the health route) keep working.
export { withinSendWindow } from "./send-window";

// One dispatch pass: send due scheduled campaigns, then due follow-ups, under the daily cap.
// Safe to call from a cron or an on-app-load tick — only already-due work is sent.
export async function runDispatch(store: Store = getStore()) {
  const limit = dailyLimit();
  const deadline = sendDeadline();
  const now = new Date();
  // `open` is the HOME window, reported as before. What actually gates each send is
  // the campaign's own zone, so a Singapore campaign can go out while India's window
  // is shut and the other way round. At night everywhere, skip the queries entirely.
  const open = withinSendWindow(now);
  const anyOpen = anySendWindowOpen(now);
  const inWindow = (c: Campaign) => withinSendWindow(now, c.sendTz);
  let budget = Math.max(0, limit - (await store.sentTodayCount()));
  const scheduled: { id: string; name: string; sent: number; throttled: number }[] = [];
  const idle: SendStats & { due: number; budgetLeft: number } = { sent: 0, failed: 0, skipped: 0, simulated: false, throttled: 0, due: 0, budgetLeft: budget };

  // Outside business hours the auto-dispatcher holds all sends (everything stays
  // queued); sourcing + inbox scan still run so the app stays current.
  if (anyOpen) {
    const due = (await store.dueScheduledCampaigns()).filter(inWindow);
    for (const c of due) {
      if (budget <= 0 || Date.now() >= deadline) break;
      const r = await sendCampaignQueued(store, c.id, budget, deadline);
      budget = r.budgetLeft;
      scheduled.push({ id: c.id, name: c.name, sent: r.sent, throttled: r.throttled });
    }
  }
  const fu = anyOpen ? await processFollowups(store, budget, deadline, inWindow) : idle;
  budget = fu.budgetLeft;
  const fu2 = anyOpen ? await processFollowups2(store, budget, deadline, inWindow) : idle;
  const apollo = await processApolloRequests(store);
  let inbox;
  try { inbox = await scanInbox(store); } catch { /* non-fatal */ }
  return {
    dailyLimit: limit,
    sendWindowOpen: open,
    scheduled,
    followups: { due: fu.due, sent: fu.sent, throttled: fu.throttled },
    followups2: { due: fu2.due, sent: fu2.sent, throttled: fu2.throttled },
    apollo,
    inbox,
  };
}

export type SendStats = { sent: number; failed: number; skipped: number; simulated: boolean; throttled: number };

// Send all queued recipients of a campaign, up to `budget` emails.
// Returns stats and the budget left.
export async function sendCampaignQueued(
  store: Store,
  campaignId: string,
  budget: number,
  deadline: number = sendDeadline(),
): Promise<SendStats & { budgetLeft: number }> {
  const stats: SendStats = { sent: 0, failed: 0, skipped: 0, simulated: false, throttled: 0 };
  const campaign = await store.getCampaign(campaignId);
  if (!campaign) return { ...stats, budgetLeft: budget };
  const template = await store.getTemplate(campaign.templateId);
  if (!template) return { ...stats, budgetLeft: budget };

  // One run per campaign at a time: a manual send, the cron and the on-open tick
  // can overlap, and two runs over the same queue would mail people twice.
  if (!(await store.claimCampaign(campaignId))) return { ...stats, budgetLeft: budget };
  // Attachments are excluded from getCampaign() to keep reads small. The blob (up to
  // ~27 MB) is loaded lazily, once, right before the first real send — a tick held
  // back by the daily/mailbox cap or the time budget never pulls it from Neon.
  let attachments: import("./types").Attachment[] | undefined;
  const recipients = await store.getRecipients(campaignId);
  // Only load the prospects this campaign actually targets (not the whole table).
  const prospects = await store.getProspectsByIds(recipients.map((r) => r.prospectId));
  const pIndex = new Map(prospects.map((p) => [p.id, p]));
  // Audit scores for the audit-outreach templates. Loaded once for the whole
  // campaign; empty for every other campaign, which simply never asks for them.
  const audits = await store.getAuditsByWebsites(
    [...new Set(prospects.map((p) => p.website).filter((w): w is string => !!w))],
  );
  const suppressed = await store.suppressedEmails();

  // Per-mailbox daily cap (warm-up / anti-throttle). 0 = disabled. Keeps a single
  // inbox under a safe send volume so it isn't flagged or limited by the provider.
  // A mailbox sending through Amazon SES isn't held to its own provider's small daily
  // limit; SES_MAILBOX_DAILY_LIMIT (default 300) keeps cold volume deliberate instead.
  const viaSes = !!resolveMailbox(campaign.fromMailbox)?.relay && (await relayAllowed(store, campaign.fromMailbox, new Map()));
  const mbLimit = viaSes ? Number(process.env.SES_MAILBOX_DAILY_LIMIT || 300) : Number(process.env.MAILBOX_DAILY_LIMIT || 0);
  let mbLeft = mbLimit > 0 ? Math.max(0, mbLimit - (await store.sentTodayByMailbox(campaign.fromMailbox))) : Infinity;

  let left = budget;
  let leftQueued = 0; // transient failures + out-of-time → stay queued for next tick
  for (const r of recipients) {
    if (r.status !== "queued") continue;

    // Protect sender reputation: never send to addresses that hard-bounced anywhere
    // before, or whose domain failed the MX check at import ("unknown").
    const p = pIndex.get(r.prospectId);
    if (suppressed.has((r.email || "").toLowerCase()) || p?.emailStatus === "unknown") {
      await store.markFailed(r.id);
      stats.skipped++;
      continue;
    }

    if (left <= 0 || mbLeft <= 0) { stats.throttled++; continue; }
    if (Date.now() >= deadline) { leftQueued++; continue; }

    // Pre-send validation: confirm the address is real (syntax + live MX) BEFORE handing
    // it to the mail server. Bad addresses are skipped, never attempted — this is what
    // keeps the bounce rate low (and an SES/Gmail account from getting suspended).
    if ((await validateAddress(r.email)) !== "valid") {
      await store.markFailed(r.id);
      stats.skipped++;
      continue;
    }

    const data = mergeDataFromProspect(p ?? { name: r.name, company: r.company, title: "", city: "", country: "" }, audits.get(p?.website || ""));
    // Spin first (per-recipient wording variation), then fill merge fields.
    const subject = renderTemplate(spin(template.subject, r.id), data);
    const personal = isPersonal(template);
    const bodyText = withOptOut(renderTemplate(spin(template.body, r.id), data), personal);
    // Last gate before the wire. An audit template whose recipient has no audit
    // row would otherwise go out reading "your site scored /100" — worse than
    // not sending at all, and unrecoverable once delivered.
    const broken = hasUnresolvedMerge(template.subject, subject, data) ?? hasUnresolvedMerge(template.body, bodyText, data);
    if (broken) {
      console.warn(`[send] blocked ${r.email}: ${broken}`);
      await store.markFailed(r.id);
      stats.skipped++;
      continue;
    }
    const html = renderBodyHtml(formatOf(template), trackOf(template), bodyText, r.id);
    attachments ??= await store.getCampaignAttachments(campaignId);
    const res = await sendEmail({ to: r.email, subject, html, text: bodyText, recipientId: r.id, mailboxId: campaign.fromMailbox, attachments, personal, allowRelay: viaSes });
    if (res.ok) {
      stats.simulated = stats.simulated || res.simulated;
      await store.markSent(r.id);
      // A successful SMTP/Resend send is accepted by the mail server = delivered.
      // Gmail SMTP has no webhook, so we record delivery here rather than waiting for one.
      await store.recordEvent(r.id, "delivered");
      stats.sent++;
      left--;
      mbLeft--;
      await pace(res.simulated, res.via);
    } else {
      const err = res.error || "";
      if (MAILBOX_LIMIT_ERROR.test(err)) {
        // The sending mailbox is out of its daily/rate quota. Stop now — retrying just
        // hammers Gmail and hurts reputation. Everything still queued waits for the
        // next window (and Gmail's rolling 24h limit to free up).
        console.warn(`[send] mailbox limit hit (${campaign.fromMailbox || "primary"}): ${err}`);
        leftQueued++;
        break;
      }
      if (!TRANSIENT_SEND_ERROR.test(err) && PERMANENT_SEND_ERROR.test(err)) {
        await store.recordEvent(r.id, "bounced");
        stats.failed++;
      } else {
        console.warn(`[send] transient failure ${r.email}: ${err}`);
        stats.failed++; // transient — stays queued, retried next dispatch
        leftQueued++;
      }
    }
  }
  // Mail left over (daily cap, mailbox cap, the provider's rate limit, time budget, a
  // transient error) must still go out. The dispatcher only picks up 'scheduled'
  // campaigns, so the campaign goes back to 'scheduled' — a hand-sent one gets a
  // schedule of "now" — and resumes by itself in its next send window, within the caps.
  const pending = stats.throttled > 0 || leftQueued > 0;
  if (pending) await store.rescheduleCampaign(campaignId, campaign.scheduledAt ?? new Date().toISOString());
  else await store.setCampaignStatus(campaignId, "sent");
  closeTransports();
  return { ...stats, budgetLeft: left };
}

// Send due follow-ups across all campaigns, up to `budget` emails.
// `inWindow` (dispatcher only) keeps a follow-up queued until its campaign's own
// send window opens; `due` then counts only what was sendable now. Manual runs
// pass no filter and send regardless, like "Send now".
export async function processFollowups(
  store: Store,
  budget: number,
  deadline: number = sendDeadline(),
  inWindow?: (c: Campaign) => boolean,
): Promise<SendStats & { due: number; budgetLeft: number }> {
  const due = await store.dueFollowups();
  return sendFollowupPass(store, budget, deadline, inWindow ? due.filter((d) => inWindow(d.campaign)) : due, "first");
}

// Send due SECOND follow-ups (the day-N "breakup" mailer after the first follow-up).
export async function processFollowups2(
  store: Store,
  budget: number,
  deadline: number = sendDeadline(),
  inWindow?: (c: Campaign) => boolean,
): Promise<SendStats & { due: number; budgetLeft: number }> {
  const due = await store.dueFollowups2();
  return sendFollowupPass(store, budget, deadline, inWindow ? due.filter((d) => inWindow(d.campaign)) : due, "second");
}

async function sendFollowupPass(
  store: Store,
  budget: number,
  deadline: number,
  due: { campaign: import("./types").Campaign; recipient: import("./types").Recipient }[],
  pass: "first" | "second",
): Promise<SendStats & { due: number; budgetLeft: number }> {
  const stats: SendStats = { sent: 0, failed: 0, skipped: 0, simulated: false, throttled: 0 };
  // Nothing due (the common tick) or no budget left: skip the template / suppression /
  // prospect reads entirely. Same result the loop below would reach.
  if (!due.length) return { ...stats, due: 0, budgetLeft: budget };
  if (budget <= 0) return { ...stats, throttled: due.length, due: due.length, budgetLeft: budget };
  const prospects = await store.getProspectsByIds(due.map((d) => d.recipient.prospectId));
  const pIndex = new Map(prospects.map((p) => [p.id, p]));
  const audits = await store.getAuditsByWebsites(
    [...new Set(prospects.map((p) => p.website).filter((w): w is string => !!w))],
  );
  const templates = new Map((await store.getTemplates()).map((t) => [t.id, t]));
  const suppressed = await store.suppressedEmails();
  const attachCache = new Map<string, import("./types").Attachment[]>(); // per-campaign, fetched once
  const relayCache = new Map<string, boolean>();

  let left = budget;
  for (const { campaign, recipient } of due) {
    if (left <= 0) { stats.throttled++; continue; }
    if (Date.now() >= deadline) { stats.throttled++; continue; }
    // Honor unsubscribes / bounces even when the recipient's own status hasn't flipped
    // (e.g. they opted out via a different campaign). Never follow up with a suppressed address.
    if (suppressed.has((recipient.email || "").toLowerCase())) { stats.skipped++; continue; }
    if ((await validateAddress(recipient.email)) !== "valid") { stats.skipped++; continue; }
    const tmplId = pass === "first" ? campaign.followupTemplateId : campaign.followup2TemplateId;
    const tmpl = tmplId ? templates.get(tmplId) : null;
    if (!tmpl) continue;
    const p = pIndex.get(recipient.prospectId);
    const data = mergeDataFromProspect(p ?? { name: recipient.name, company: recipient.company, title: "", city: "", country: "" }, audits.get(p?.website || ""));
    const subject = renderTemplate(spin(tmpl.subject, recipient.id), data);
    const personal = isPersonal(tmpl);
    const bodyText = withOptOut(renderTemplate(spin(tmpl.body, recipient.id), data), personal);
    const broken = hasUnresolvedMerge(tmpl.subject, subject, data) ?? hasUnresolvedMerge(tmpl.body, bodyText, data);
    if (broken) {
      console.warn(`[followup] blocked ${recipient.email}: ${broken}`);
      stats.skipped++;
      continue;
    }
    const html = renderBodyHtml(formatOf(tmpl), trackOf(tmpl), bodyText, recipient.id);
    if (!attachCache.has(campaign.id)) attachCache.set(campaign.id, await store.getCampaignAttachments(campaign.id));
    const allowRelay = await relayAllowed(store, campaign.fromMailbox, relayCache);
    const res = await sendEmail({ to: recipient.email, subject, html, text: bodyText, recipientId: recipient.id, mailboxId: campaign.fromMailbox, attachments: attachCache.get(campaign.id), personal, allowRelay });
    if (res.ok) {
      stats.simulated = stats.simulated || res.simulated;
      if (pass === "first") await store.markFollowupSent(recipient.id);
      else await store.markFollowup2Sent(recipient.id);
      stats.sent++;
      left--;
      await pace(res.simulated, res.via);
    } else {
      const err = res.error || "";
      if (MAILBOX_LIMIT_ERROR.test(err)) {
        console.warn(`[followup] mailbox limit hit (${campaign.fromMailbox || "primary"}): ${err}`);
        break;
      }
      if (!TRANSIENT_SEND_ERROR.test(err) && PERMANENT_SEND_ERROR.test(err)) {
        await store.recordEvent(recipient.id, "bounced");
        stats.failed++;
      } else {
        console.warn(`[followup] transient failure ${recipient.email}: ${err}`);
        stats.failed++;
      }
    }
  }
  closeTransports();
  return { ...stats, due: due.length, budgetLeft: left };
}
