import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { auditWithCache } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Score a set of business websites. Cached rows younger than AUDIT_TTL_DAYS are
 * returned as-is; everything else is sent to Maveriko and cached.
 *
 * The caller sends websites in small batches and calls repeatedly — one audit
 * takes 15-25s, so a hundred businesses is a grind measured in minutes, not a
 * single request.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const raw: string[] = Array.isArray(b.websites) ? b.websites : [];
  if (!raw.length) return NextResponse.json({ error: "websites required" }, { status: 400 });
  // Normalising + de-duping happens inside auditWithCache: two Maps listings for the
  // same chain often carry the same site.
  return NextResponse.json(await auditWithCache(getStore(), raw));
}
