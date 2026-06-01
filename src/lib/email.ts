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

// Convert plain-text body to HTML, rewrite links through the click tracker,
// and append a 1x1 open-tracking pixel.
export function buildHtml(bodyText: string, recipientId: string): string {
  const base = appUrl();
  const escaped = bodyText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Linkify URLs (http(s):// and www./bare domains) and route them through the
  // click tracker so clicks are captured. Skips anything that's part of an email address.
  const linked = escaped.replace(
    /(^|[\s(>])((?:https?:\/\/|www\.)[^\s<)]+|[a-z0-9.-]+\.(?:com|co|io|ai|in|org|net|co\.in|us|dev)(?:\/[^\s<)]*)?)/gi,
    (m, pre: string, raw: string) => {
      // don't linkify email addresses (preceding char is @ handled by \s gate; also skip if looks like local@domain)
      const href = raw.startsWith("http") ? raw : `https://${raw.replace(/^www\./, "www.")}`;
      const tracked = `${base}/api/track/click/${recipientId}?url=${encodeURIComponent(href)}`;
      return `${pre}<a href="${tracked}" style="color:#4f46e5">${raw}</a>`;
    },
  );

  const html = linked.replace(/\n/g, "<br/>");
  const pixel = `<img src="${base}/api/track/open/${recipientId}" width="1" height="1" alt="" style="display:none"/>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${html}${pixel}</div>`;
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
  return { subject, bodyText, html: buildHtml(bodyText, recipientId) };
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
