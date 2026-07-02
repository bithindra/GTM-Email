import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Resend event webhook. Configure in Resend dashboard -> Webhooks pointing at
// {APP_URL}/api/webhooks/resend. We map Resend event types to recipient events.
// The recipient id is carried in the email's tags/headers; for the demo we accept
// a `recipientId` field in the payload data.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const type: string = body.type || "";
  const data = body.data || {};
  const recipientId: string | undefined = data.recipientId || data.tags?.recipientId;
  if (!recipientId) return NextResponse.json({ ok: true, ignored: "no recipientId" });

  const store = getStore();
  if (type === "email.delivered") await store.recordEvent(recipientId, "delivered");
  else if (type === "email.opened") await store.recordEvent(recipientId, "opened");
  else if (type === "email.clicked") await store.recordEvent(recipientId, "clicked");
  else if (type === "email.bounced" || type === "email.complained") {
    await store.recordEvent(recipientId, "bounced");
    // A spam complaint is a permanent opt-out — suppress the address itself so it stays
    // blocked even if the prospect is re-imported into a fresh campaign later.
    if (type === "email.complained") {
      const r = await store.getRecipient(recipientId);
      if (r?.email) await store.suppress(r.email, "complaint");
    }
  }
  return NextResponse.json({ ok: true });
}
