import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { SearchFilters } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const requests = await getStore().listSourcingRequests();
  return NextResponse.json({ requests });
}

// Submit an ICP as a live-sourcing request. Claude fulfills it via Explorium +
// email verification and lands the results as a named list (no mock, no cost).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const filters: SearchFilters = {
    countries: b.countries ?? [],
    sizes: b.sizes ?? [],
    titles: b.titles ?? [],
    industries: b.industries ?? [],
    seniorities: b.seniorities ?? [],
    revenueRanges: b.revenueRanges ?? [],
    keywords: b.keywords ?? "",
    limit: b.limit ?? 25,
  };
  const request = await getStore().createSourcingRequest(filters);
  return NextResponse.json({ request });
}
