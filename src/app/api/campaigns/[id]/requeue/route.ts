import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Reset this campaign's bounced recipients back to queued so they get retried.
// Useful when a sending mailbox hit its daily limit mid-send (a quota 550, not a real
// bad address) — those should be re-attempted, not abandoned.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  const requeued = await store.requeueBounced(id);
  return NextResponse.json({ ok: true, requeued });
}
