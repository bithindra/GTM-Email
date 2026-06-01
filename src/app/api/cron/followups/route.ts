import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { processFollowups, dailyLimit } from "@/lib/sender";

export const dynamic = "force-dynamic";

// Kept for manual/legacy use. The scheduled dispatcher is /api/cron/dispatch.
function authorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) return true;
  const ingest = process.env.INGEST_TOKEN;
  if (ingest && req.headers.get("x-ingest-token") === ingest) return true;
  return !cronSecret && !ingest;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore();
  const budget = Math.max(0, dailyLimit() - (await store.sentTodayCount()));
  const r = await processFollowups(store, budget);
  return NextResponse.json({ ok: true, due: r.due, sent: r.sent, failed: r.failed, simulated: r.simulated, throttled: r.throttled });
}
export const POST = GET;
