import { NextRequest, NextResponse } from "next/server";
import { runDispatch } from "@/lib/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // paced sends need room; loop self-limits via DISPATCH_TIME_BUDGET_MS

// Scheduled twice in vercel.json (Hobby allows daily crons only, fired anywhere
// in the hour). Each run sends only campaigns whose own zone is open, so:
//   0 9  UTC → 14:30 IST, 17:00 SGT — India + Singapore; US is still night.
//   0 17 UTC → 13:00 ET / 10:00 PT (12:00 / 09:00 in winter) — US only;
//              it is 22:30 IST and 01:00 SGT, so India/Singapore stay queued.

function authorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) return true;
  const ingest = process.env.INGEST_TOKEN;
  if (ingest && req.headers.get("x-ingest-token") === ingest) return true;
  return !cronSecret && !ingest;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runDispatch()) });
}
export const POST = GET;
