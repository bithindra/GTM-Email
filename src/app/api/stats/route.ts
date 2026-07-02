import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  // All counts come from SQL aggregates — no full-table row dumps (Neon transfer).
  const s = await store.statsSummary();
  const campaignPerformance = await store.campaignPerformance();
  const sentToday = await store.sentTodayCount();
  const campaigns = await store.getCampaigns(); // cheap now (attachments excluded) — for the scheduled list
  const dailyLimit = Number(process.env.SEND_DAILY_LIMIT || 400);
  const scheduled = campaigns.filter((c) => c.status === "scheduled");

  const { sent, delivered, opened, clicked, replied, bounced } = s;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  const funnel = [
    { stage: "Sent", value: sent },
    { stage: "Delivered", value: delivered },
    { stage: "Opened", value: opened },
    { stage: "Clicked", value: clicked },
    { stage: "Replied", value: replied },
  ];

  return NextResponse.json({
    totals: { prospects: s.prospects, campaigns: campaignPerformance.length, sent, delivered, opened, clicked, replied, bounced },
    rates: {
      deliveryRate: pct(delivered, sent),
      openRate: pct(opened, delivered),
      clickRate: pct(clicked, delivered),
      replyRate: pct(replied, delivered),
      bounceRate: pct(bounced, sent),
    },
    funnel,
    sendBudget: { sentToday, dailyLimit, remaining: Math.max(0, dailyLimit - sentToday) },
    campaignPerformance,
    scheduled: scheduled
      .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""))
      .map((c) => ({ id: c.id, name: c.name, scheduledAt: c.scheduledAt, recipientCount: c.recipientCount })),
  });
}
