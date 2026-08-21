import type { Attachment, Prospect, Recipient, Template } from "./types";
import { resolveMailbox } from "./mailboxes";

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

type MergeData = {
  first_name: string;
  name: string;
  company: string;
  title: string;
  city: string;
  country: string;
};

export function mergeDataFromProspect(p: Pick<Prospect, "name" | "company" | "title" | "city" | "country">): MergeData {
  return {
    first_name: (p.name || "").split(" ")[0] || "there",
    name: p.name || "",
    company: p.company || "your company",
    title: p.title || "",
    city: p.city || "",
    country: p.country || "",
  };
}

export function renderTemplate(text: string, data: MergeData): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (data as Record<string, string>)[k] ?? `{{${k}}}`);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Spintax: resolve {option a|option b|option c} groups so every recipient gets a
// slightly different wording. Deterministic per recipient (seed = recipient id) so
// previews are stable and re-sends are consistent. Innermost groups resolve first
// (supports nesting); {{merge_fields}} are untouched (they contain no "|").
export function spin(text: string, seed: string): string {
  const re = /\{([^{}]*\|[^{}]*)\}/;
  let out = text, n = 0, guard = 0;
  while (re.test(out) && guard++ < 500) {
    out = out.replace(re, (_, body: string) => {
      const opts = body.split("|");
      return opts[hashStr(`${seed}:${n++}`) % opts.length];
    });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Linkify URLs and route them through the click tracker. Input must be escaped.
function linkifyTracked(escaped: string, recipientId: string): string {
  const base = appUrl();
  return escaped.replace(
    /(^|[\s(>])((?:https?:\/\/|www\.)[^\s<)]+|[a-z0-9.-]+\.(?:com|co|io|ai|in|org|net|co\.in|us|dev)(?:\/[^\s<)]*)?)/gi,
    (m, pre: string, raw: string) => {
      const href = raw.startsWith("http") ? raw : `https://${raw.replace(/^www\./, "www.")}`;
      const tracked = `${base}/api/track/click/${recipientId}?url=${encodeURIComponent(href)}`;
      return `${pre}<a href="${tracked}" style="color:#4f46e5">${raw}</a>`;
    },
  );
}

// Linkify without tracking — links point straight at their destination. Used for the
// "plain" / no-tracking format, which looks like a normal human email (a redirect
// through a tracking domain is itself a spam signal). Input must be escaped.
function linkifyPlain(escaped: string): string {
  return escaped.replace(
    /(^|[\s(>])((?:https?:\/\/|www\.)[^\s<)]+|[a-z0-9.-]+\.(?:com|co|io|ai|in|org|net|co\.in|us|dev)(?:\/[^\s<)]*)?)/gi,
    (m, pre: string, raw: string) => {
      const href = raw.startsWith("http") ? raw : `https://${raw}`;
      return `${pre}<a href="${href}" style="color:#4f46e5">${raw}</a>`;
    },
  );
}

// Link renderer chosen by whether tracking is on.
function linkify(escaped: string, recipientId: string, track: boolean): string {
  return track ? linkifyTracked(escaped, recipientId) : linkifyPlain(escaped);
}

function openPixel(recipientId: string): string {
  return `<img src="${appUrl()}/api/track/open/${recipientId}" width="1" height="1" alt="" style="display:none"/>`;
}

// One-click unsubscribe URL for this recipient (RFC 8058 / Gmail-Yahoo bulk rules).
export function unsubscribeUrl(recipientId: string): string {
  return `${appUrl()}/api/unsubscribe/${recipientId}`;
}

// Sender's display name (from EMAIL_FROM "Name <addr>") for the newsletter header.
function brandName(): string {
  const disp = (process.env.EMAIL_FROM || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  return disp || "Our Team";
}

export type Format = "plain" | "rich" | "newsletter";

// "plain" — looks like a normal typed email: minimal markup, no card, no tracking
// pixel by default. The most human / highest-inboxing format for 1:1 cold outreach.
export function buildPlain(bodyText: string, recipientId: string, track: boolean): string {
  const html = linkify(escapeHtml(bodyText), recipientId, track).replace(/\n/g, "<br/>");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222">${html}${track ? openPixel(recipientId) : ""}</div>`;
}

// "rich" — light 1:1 styling (same as plain today but tracking on by default).
export function buildHtml(bodyText: string, recipientId: string, track = true): string {
  const html = linkify(escapeHtml(bodyText), recipientId, track).replace(/\n/g, "<br/>");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${html}${track ? openPixel(recipientId) : ""}</div>`;
}

// "newsletter" — clean branded card with header + footer for broadcasts.
export function buildNewsletterHtml(bodyText: string, recipientId: string, track = true): string {
  const brand = brandName();
  const paras = bodyText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 16px 0">${linkify(escapeHtml(block), recipientId, track).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return (
    `<div style="background:#f1f5f9;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
      `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">` +
        `<div style="background:#4f46e5;padding:18px 28px"><span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px">${escapeHtml(brand)}</span></div>` +
        `<div style="padding:28px;font-size:15px;line-height:1.7;color:#0f172a">${paras}</div>` +
        `<div style="padding:16px 28px;border-top:1px solid #eef2f7;color:#94a3b8;font-size:12px;line-height:1.5">You're receiving this update from ${escapeHtml(brand)}. Just reply to this email to reach us, or <a href="${unsubscribeUrl(recipientId)}" style="color:#94a3b8;text-decoration:underline">unsubscribe</a>.</div>` +
      `</div>` +
      (track ? openPixel(recipientId) : "") +
    `</div>`
  );
}

// Resolve a template's format ("plain" default) from the new field or legacy `type`.
export function formatOf(t: Pick<Template, "format" | "type">): Format {
  if (t.format) return t.format;
  return t.type === "newsletter" ? "newsletter" : "rich";
}
// Tracking on/off — explicit flag, else on for rich/newsletter, off for plain.
export function trackOf(t: Pick<Template, "track" | "format" | "type">): boolean {
  if (typeof t.track === "boolean") return t.track;
  return formatOf(t) !== "plain";
}

// Pick the renderer based on format + tracking.
export function renderBodyHtml(format: Format, track: boolean, bodyText: string, recipientId: string): string {
  if (format === "newsletter") return buildNewsletterHtml(bodyText, recipientId, track);
  if (format === "rich") return buildHtml(bodyText, recipientId, track);
  return buildPlain(bodyText, recipientId, track);
}

export type SendResult = { ok: boolean; simulated: boolean; id?: string; error?: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string; // plain-text alternative — multipart emails score better with spam filters
  recipientId?: string; // enables the one-click HTTP unsubscribe link
  mailboxId?: string | null; // which configured Gmail mailbox to send from (null = primary)
  attachments?: Attachment[];
}): Promise<SendResult> {
  // Pick the sending mailbox (chosen per-campaign); falls back to the primary.
  const mailbox = resolveMailbox(opts.mailboxId);
  const from = mailbox?.from || process.env.EMAIL_FROM || "GTM Flow <onboarding@resend.dev>";
  // Replies should land in the sending mailbox itself.
  const replyTo = mailbox?.replyTo || process.env.REPLY_TO || process.env.SMTP_USER || (from.match(/<([^>]+)>/)?.[1] ?? undefined);
  const files = opts.attachments ?? [];
  // List-Unsubscribe + one-click POST is required by Gmail/Yahoo bulk-sender rules and
  // is the single biggest inbox-placement lever. Offer the HTTP one-click endpoint
  // (RFC 8058) plus a mailto: fallback; mailbox providers prefer the https form.
  const headers: Record<string, string> = {};
  const unsubParts: string[] = [];
  if (opts.recipientId) unsubParts.push(`<${unsubscribeUrl(opts.recipientId)}>`);
  if (replyTo) unsubParts.push(`<mailto:${replyTo}?subject=unsubscribe>`);
  if (unsubParts.length) headers["List-Unsubscribe"] = unsubParts.join(", ");
  if (opts.recipientId) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";

  // 1. SMTP — preferred when configured. Host/port come from the chosen mailbox, so a
  // Gmail sender (smtp.gmail.com) and a custom-domain sender (e.g. smtp.hostinger.com)
  // can coexist across campaigns.
  if (mailbox?.user && mailbox?.pass) {
    try {
      const nodemailer = (await import("nodemailer")).default;
      const transport = nodemailer.createTransport({
        host: mailbox.host,
        port: mailbox.port,
        secure: mailbox.port === 465,
        auth: { user: mailbox.user, pass: mailbox.pass },
      });
      const info = await transport.sendMail({
        from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, replyTo, headers,
        attachments: files.map((a) => ({ filename: a.filename, content: a.content, encoding: "base64", contentType: a.contentType })),
      });
      return { ok: true, simulated: false, id: info.messageId };
    } catch (e) {
      return { ok: false, simulated: false, error: (e as Error).message };
    }
  }

  // 2. Resend (verified-domain sending).
  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(key);
      const res = await resend.emails.send({
        from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, replyTo, headers,
        attachments: files.map((a) => ({ filename: a.filename, content: a.content })),
      });
      if (res.error) return { ok: false, simulated: false, error: res.error.message };
      return { ok: true, simulated: false, id: res.data?.id };
    } catch (e) {
      return { ok: false, simulated: false, error: (e as Error).message };
    }
  }

  // 3. Simulated send so the full pipeline is demoable without keys.
  return { ok: true, simulated: true, id: "sim_" + Math.random().toString(36).slice(2) };
}

// Authenticate against a mailbox's SMTP server WITHOUT sending anything. This is the
// only way to prove a slot's host/port/password are correct — a wrong password shows up
// here as `535 authentication failed` instead of as a silent campaign-wide failure.
export async function verifyMailbox(mailbox: { host: string; port: number; user: string; pass: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: mailbox.host,
      port: mailbox.port,
      secure: mailbox.port === 465,
      auth: { user: mailbox.user, pass: mailbox.pass },
    });
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function previewFor(template: Template, sample: MergeData, recipientId = "preview") {
  const subject = renderTemplate(spin(template.subject, recipientId), sample);
  const bodyText = renderTemplate(spin(template.body, recipientId), sample);
  return { subject, bodyText, html: renderBodyHtml(formatOf(template), trackOf(template), bodyText, recipientId) };
}

export const SAMPLE_MERGE: MergeData = {
  first_name: "Sofia",
  name: "Sofia Garcia",
  company: "Nova Labs",
  title: "Founder & CEO",
  city: "San Francisco",
  country: "United States",
};

export type { MergeData, Recipient };
