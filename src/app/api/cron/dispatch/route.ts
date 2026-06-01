import { NextRequest, NextResponse } from "next/server";
import { runDispatch } from "@/lib/sender";

export const dynamic = "force-dynamic";

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
