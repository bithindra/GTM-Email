import type { Attachment, Prospect, Recipient, Template } from "./types";

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

function openPixel(recipientId: string): string {
  return `<img src="${appUrl()}/api/track/open/${recipientId}" width="1" height="1" alt="" style="display:none"/>`;
}

// Sender's display name (from EMAIL_FROM "Name <addr>") for the newsletter header.
function brandName(): string {
  const disp = (process.env.EMAIL_FROM || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  return disp || "Our Team";
}

// Convert plain-text body to HTML, rewrite links through the click tracker,
// and append a 1x1 open-tracking pixel. (1:1 outreach styling.)
export function buildHtml(bodyText: string, recipientId: string): string {
  const html = linkifyTracked(escapeHtml(bodyText), recipientId).replace(/\n/g, "<br/>");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${html}${openPixel(recipientId)}</div>`;
}

// Broadcast / company-update styling: a clean, branded newsletter shell. The body
// is still plain text (blank line = new paragraph) so it stays easy to edit, but
// it renders inside a polished card with header + footer.
export function buildNewsletterHtml(bodyText: string, recipientId: string): string {
  const brand = brandName();
  const paras = bodyText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 16px 0">${linkifyTracked(escapeHtml(block), recipientId).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return (
    `<div style="background:#f1f5f9;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
      `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">` +
        `<div style="background:#4f46e5;padding:18px 28px"><span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px">${escapeHtml(brand)}</span></div>` +
        `<div style="padding:28px;font-size:15px;line-height:1.7;color:#0f172a">${paras}</div>` +
        `<div style="padding:16px 28px;border-top:1px solid #eef2f7;color:#94a3b8;font-size:12px;line-height:1.5">You're receiving this update from ${escapeHtml(brand)}. Just reply to this email to reach us.</div>` +
      `</div>` +
      openPixel(recipientId) +
    `</div>`
  );
}

// Pick the renderer based on the template type.
export function renderBodyHtml(type: Template["type"], bodyText: string, recipientId: string): string {
  return type === "newsletter" ? buildNewsletterHtml(bodyText, recipientId) : buildHtml(bodyText, recipientId);
}

export type SendResult = { ok: boolean; simulated: boolean; id?: string; error?: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}): Promise<SendResult> {
  const from = process.env.EMAIL_FROM || "GTM Flow <onboarding@resend.dev>";
  // Replies should land in the sending mailbox. Default to the Gmail/SMTP user
  // (or REPLY_TO override), so "reply" goes to brandvibe2k26@gmail.com.
  const replyTo = process.env.REPLY_TO || process.env.SMTP_USER || (from.match(/<([^>]+)>/)?.[1] ?? undefined);
  const files = opts.attachments ?? [];

  // 1. Gmail / SMTP — preferred when configured (lets you send FROM a Gmail address).
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const nodemailer = (await import("nodemailer")).default;
      const port = Number(process.env.SMTP_PORT || 465);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const info = await transport.sendMail({
        from, to: opts.to, subject: opts.subject, html: opts.html, replyTo,
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
        from, to: opts.to, subject: opts.subject, html: opts.html, replyTo,
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

export function previewFor(template: Template, sample: MergeData, recipientId = "preview") {
  const subject = renderTemplate(template.subject, sample);
  const bodyText = renderTemplate(template.body, sample);
  return { subject, bodyText, html: renderBodyHtml(template.type, bodyText, recipientId) };
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
