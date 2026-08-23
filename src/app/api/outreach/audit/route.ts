import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { auditBatch, isStale, normalizeWebsite } from "@/lib/audit";
import type { AuditRecord } from "@/lib/types";

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

  // Normalize and dedupe before doing anything expensive: two Maps listings for
  // the same chain often carry the same site.
  const wanted = [...new Set(raw.map(normalizeWebsite).filter((w): w is string => !!w))];
  if (!wanted.length) return NextResponse.json({ results: [], cached: 0, audited: 0 });

  const store = getStore();
  const cache = await store.getAuditsByWebsites(wanted);

  const fresh: AuditRecord[] = [];
  const toRun: string[] = [];
  for (const w of wanted) {
    const hit = cache.get(w);
    // Re-run failures too: a site that was down last week may be up now.
    if (hit && hit.status === "ok" && !isStale(hit)) fresh.push(hit);
    else toRun.push(w);
  }

  const ran = toRun.length ? await auditBatch(toRun) : [];
  if (ran.length) await store.upsertAudits(ran);

  return NextResponse.json({
    results: [...fresh, ...ran],
    cached: fresh.length,
    audited: ran.length,
  });
}
