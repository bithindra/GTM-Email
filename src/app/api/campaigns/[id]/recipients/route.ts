import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Remove recipients from a campaign (so those clients won't be mailed).
// Body: { ids: string[] }   (omit/empty ids with all:true to clear the whole campaign)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const store = getStore();
  let ids: string[] = Array.isArray(b.ids) ? b.ids : [];
  if (b.all) {
    ids = (await store.getRecipients(id)).map((r) => r.id);
  }
  if (!ids.length) return NextResponse.json({ error: "no recipient ids" }, { status: 400 });
  const removed = await store.deleteRecipients(id, ids);
  const campaign = await store.getCampaign(id);
  return NextResponse.json({ ok: true, removed, recipientCount: campaign?.recipientCount ?? 0 });
}
