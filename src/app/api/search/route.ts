import { NextRequest, NextResponse } from "next/server";
import { searchProspects } from "@/lib/apollo";
import type { SearchFilters } from "@/lib/types";

export const dynamic = "force-dynamic";

// Live Apollo discovery. Returns people (emails masked until saved/enriched).
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
  const { source, prospects, error, note } = await searchProspects(filters);
  return NextResponse.json({ source, count: prospects.length, prospects, error, note });
}
