import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isBlockedSunday } from "@/lib/send-window";
import { processFollowups, processFollowups2, dailyLimit } from "@/lib/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // paced sends need room; loop self-limits via DISPATCH_TIME_BUDGET_MS

// Manually send the follow-up (second mailer) for due recipients (respects daily cap).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The standing rule holds for manual sends too: never on a Sunday (home or recipients' zone).
  if (isBlockedSunday(new Date(), campaign.sendTz)) {
    return NextResponse.json({ error: "It's Sunday — sending is switched off. Schedule it and it will go out on Monday." }, { status: 409 });
  }
  if (!campaign.followupTemplateId) return NextResponse.json({ error: "no follow-up template configured" }, { status: 400 });

  let budget = Math.max(0, dailyLimit() - (await store.sentTodayCount()));
  // processFollowups handles all campaigns; for a single-campaign manual run we still
  // honor the global cap and only its due recipients will exist if others aren't due.
  const due = (await store.dueFollowups()).filter((d) => d.campaign.id === id);
  const due2 = (await store.dueFollowups2()).filter((d) => d.campaign.id === id);
  if (due.length === 0 && due2.length === 0) return NextResponse.json({ ok: true, due: 0, sent: 0, failed: 0 });
  const r = await processFollowups(store, budget);
  budget = r.budgetLeft;
  const r2 = campaign.followup2TemplateId ? await processFollowups2(store, budget) : { due: 0, sent: 0, failed: 0, simulated: false, throttled: 0 };
  return NextResponse.json({
    ok: true,
    due: r.due + r2.due,
    sent: r.sent + r2.sent,
    failed: r.failed + r2.failed,
    simulated: r.simulated || r2.simulated,
    throttled: r.throttled + r2.throttled,
  });
}
