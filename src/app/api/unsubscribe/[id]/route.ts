import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Resolve the recipient's email and add it to the permanent suppression list so no
// campaign or follow-up ever mails them again.
async function optOut(id: string): Promise<string | null> {
  const store = getStore();
  const r = await store.getRecipient(id);
  if (!r?.email) return null;
  await store.suppress(r.email, "unsubscribe");
  return r.email;
}

// One-click unsubscribe (RFC 8058): mailbox providers POST here directly, no body.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await optOut(id);
  return new NextResponse(null, { status: 200 });
}

// Human click from the visible link — confirm in a tiny styled page.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await optOut(id);
  const msg = email
    ? `<strong>${email}</strong> has been unsubscribed. You won't receive any further emails from us.`
    : `This unsubscribe link is no longer valid, but you can simply reply with "unsubscribe" and we'll remove you.`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;margin:0;padding:0">
  <div style="max-width:480px;margin:64px auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:32px;text-align:center;color:#0f172a">
    <div style="font-size:20px;font-weight:700;margin-bottom:12px">You're unsubscribed</div>
    <p style="font-size:15px;line-height:1.6;color:#475569;margin:0">${msg}</p>
  </div>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
