import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isBlockedSunday } from "@/lib/send-window";
import { sendCampaignQueued, dailyLimit } from "@/lib/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // paced sends need room; loop self-limits via DISPATCH_TIME_BUDGET_MS

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The standing rule holds for manual sends too: never on a Sunday (home or recipients' zone).
  if (isBlockedSunday(new Date(), campaign.sendTz)) {
    return NextResponse.json({ error: "It's Sunday — sending is switched off. Schedule it and it will go out on Monday." }, { status: 409 });
  }

  const limit = dailyLimit();
  const budget = Math.max(0, limit - (await store.sentTodayCount()));
  const r = await sendCampaignQueued(store, id, budget);
  return NextResponse.json({ ok: true, sent: r.sent, failed: r.failed, simulated: r.simulated, throttled: r.throttled, dailyLimit: limit });
}
