import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { scanInbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Read the Gmail inbox and auto-mark replies + bounces. Safe to call on demand.
export async function GET() {
  const r = await scanInbox(getStore());
  return NextResponse.json(r);
}
export const POST = GET;
