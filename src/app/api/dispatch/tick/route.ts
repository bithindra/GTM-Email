import { NextResponse } from "next/server";
import { runDispatch } from "@/lib/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // paced sends need room; loop self-limits via DISPATCH_TIME_BUDGET_MS

// Public, side-effect-safe tick: only sends campaigns/follow-ups that are already
// DUE, bounded by the daily cap. Called from the app on load so scheduled sends
// fire promptly on the Hobby plan (where cron runs only once/day).
export async function GET() {
  try {
    const r = await runDispatch();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}
