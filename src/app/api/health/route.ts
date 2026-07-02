import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { publicMailboxes } from "@/lib/mailboxes";
import { withinSendWindow, dailyLimit } from "@/lib/sender";

export const dynamic = "force-dynamic";

// Lightweight platform health for the dashboard strip: DB reachability, configured
// mailboxes, whether the auto-send window is open, and today's budget usage.
export async function GET() {
  let db = true;
  let sentToday = 0;
  try {
    sentToday = await getStore().sentTodayCount();
  } catch {
    db = false;
  }
  return NextResponse.json({
    db,
    mailboxes: publicMailboxes().length,
    sendWindowOpen: withinSendWindow(),
    sentToday,
    dailyLimit: dailyLimit(),
  });
}
