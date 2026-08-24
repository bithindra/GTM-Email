import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Undo bounces that engagement proves were false.
 *
 * The inbox scanner used to treat any delivery notice as permanent, so temporary ones
 * ("Delivery Status Notification (Delay)", "inbox full") marked recipients bounced.
 * A recipient that opened, clicked or replied demonstrably received the mail, so a
 * "bounced" status on that row is wrong — restore the status the engagement implies.
 *
 *   GET  → dry run, lists what would change
 *   POST → applies the correction
 *
 * Deliberately conservative: it only touches rows with positive proof of delivery, so a
 * genuinely dead address is never resurrected and re-mailed.
 */
export async function GET() {
  const rows = await getStore().recoverFalseBounces(true);
  return NextResponse.json({ dryRun: true, count: rows.length, recipients: rows });
}

export async function POST(_req: NextRequest) {
  const rows = await getStore().recoverFalseBounces(false);
  return NextResponse.json({ dryRun: false, recovered: rows.length, recipients: rows });
}
