import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { sendCampaignQueued, dailyLimit } from "@/lib/sender";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  const limit = dailyLimit();
  const budget = Math.max(0, limit - (await store.sentTodayCount()));
  const r = await sendCampaignQueued(store, id, budget);
  return NextResponse.json({ ok: true, sent: r.sent, failed: r.failed, simulated: r.simulated, throttled: r.throttled, dailyLimit: limit });
}
