import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { processFollowups, dailyLimit } from "@/lib/sender";

export const dynamic = "force-dynamic";

// Manually send the follow-up (second mailer) for due recipients (respects daily cap).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!campaign.followupTemplateId) return NextResponse.json({ error: "no follow-up template configured" }, { status: 400 });

  const budget = Math.max(0, dailyLimit() - (await store.sentTodayCount()));
  // processFollowups handles all campaigns; for a single-campaign manual run we still
  // honor the global cap and only its due recipients will exist if others aren't due.
  const due = (await store.dueFollowups()).filter((d) => d.campaign.id === id);
  if (due.length === 0) return NextResponse.json({ ok: true, due: 0, sent: 0, failed: 0 });
  const r = await processFollowups(store, budget);
  return NextResponse.json({ ok: true, due: r.due, sent: r.sent, failed: r.failed, simulated: r.simulated, throttled: r.throttled });
}
