import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const recipients = await store.allRecipients();
  const campaigns = await store.getCampaigns();

  const sentToday = await store.sentTodayCount();
  const dailyLimit = Number(process.env.SEND_DAILY_LIMIT || 400);
  const scheduled = campaigns.filter((c) => c.status === "scheduled");

  // Per-campaign performance
  const campaignPerformance = campaigns.map((c) => {
    const rs = recipients.filter((r) => r.campaignId === c.id);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      recipients: rs.length || c.recipientCount,
      sent: rs.filter((r) => r.sentAt).length,
      delivered: rs.filter((r) => r.deliveredAt).length,
      opened: rs.filter((r) => r.openedAt).length,
      clicked: rs.filter((r) => r.clickedAt).length,
      replied: rs.filter((r) => r.repliedAt).length,
    };
  });

  const sent = recipients.filter((r) => r.sentAt).length;
  const delivered = recipients.filter((r) => r.deliveredAt).length;
  const opened = recipients.filter((r) => r.openedAt).length;
  const clicked = recipients.filter((r) => r.clickedAt).length;
  const replied = recipients.filter((r) => r.repliedAt).length;
  const bounced = recipients.filter((r) => r.status === "bounced").length;

  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  // Funnel for the bar chart
  const funnel = [
    { stage: "Sent", value: sent },
    { stage: "Delivered", value: delivered },
    { stage: "Opened", value: opened },
    { stage: "Clicked", value: clicked },
    { stage: "Replied", value: replied },
  ];

  return NextResponse.json({
    totals: {
      prospects: (await store.listProspects()).length,
      campaigns: campaigns.length,
      sent,
      delivered,
      opened,
      clicked,
      replied,
      bounced,
    },
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
