import { NextRequest, NextResponse } from "next/server";
import { searchProspects } from "@/lib/apollo";
import { filtersFromBody } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // large pulls page through Apollo (100 results/page)

// Live Apollo discovery. Returns people (emails masked until saved/enriched).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const filters = filtersFromBody(b && typeof b === "object" ? b : {});
  const { source, prospects, error, note } = await searchProspects(filters);
  return NextResponse.json({ source, count: prospects.length, prospects, error, note });
}
