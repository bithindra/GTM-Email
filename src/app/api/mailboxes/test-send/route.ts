import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { resolveMailbox } from "@/lib/mailboxes";
import { sendEmail, previewFor, SAMPLE_MERGE } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send ONE real mail from a chosen mailbox to a chosen address — for scoring a sender
 * on mail-tester.com without polluting the campaign list with a throwaway campaign.
 *
 * Authenticated on purpose: an open "send to any address" endpoint is a spam relay.
 * Reuses the same header contract as the cron routes.
 *
 *   POST /api/mailboxes/test-send
 *   x-ingest-token: <INGEST_TOKEN>
 *   { "to": "abc@mail-tester.com", "mailboxId": "partnerships@xambaaz.com",
 *     "templateId": "<optional — sends that mail's real rendered content>" }
 */
function authorized(req: NextRequest): boolean {
  const ingest = process.env.INGEST_TOKEN;
  if (ingest && req.headers.get("x-ingest-token") === ingest) return true;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) return true;
  return !ingest && !cronSecret; // only open when no secret is configured at all
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const to = typeof b.to === "string" ? b.to.trim() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "a valid `to` address is required" }, { status: 400 });
  }

  const mailbox = resolveMailbox(b.mailboxId);
  if (!mailbox) return NextResponse.json({ error: "no sending mailbox configured" }, { status: 400 });

  // Send the real rendered template when one is named, so the content is scored as it
  // would actually go out. Otherwise a minimal plain note — enough to score auth.
  let subject = "Test send from GTM Flow";
  let html = "<p>This is a test send used to check sender authentication and inbox placement.</p>";
  let text = "This is a test send used to check sender authentication and inbox placement.";
  if (b.templateId) {
    const t = await getStore().getTemplate(String(b.templateId));
    if (!t) return NextResponse.json({ error: "template not found" }, { status: 404 });
    const p = previewFor(t, SAMPLE_MERGE);
    subject = p.subject;
    html = p.html;
    text = p.bodyText;
  }

  // No recipientId: a test send must not create tracking or unsubscribe links pointing
  // at a recipient row that does not exist.
  const res = await sendEmail({ to, subject, html, text, mailboxId: mailbox.id });
  return NextResponse.json({
    ...res,
    from: mailbox.from,
    host: mailbox.host,
    port: mailbox.port,
    to,
    subject,
  }, { status: res.ok ? 200 : 502 });
}
