import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Per-template results (SQL-aggregated, tiny payload). Opens/clicks/replies are
// attributed to the campaign's FIRST mail template — the mail that earns the open.
export async function GET() {
  const perf = await getStore().templatePerformance();
  return NextResponse.json({ performance: perf });
}
