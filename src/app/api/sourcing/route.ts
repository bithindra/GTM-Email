import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { filtersFromBody } from "@/lib/filters";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const requests = await getStore().listSourcingRequests();
    return NextResponse.json({ requests });
  } catch (e) {
    console.error("GET /api/sourcing", e);
    return NextResponse.json({ error: "Couldn’t reach the database just now — nothing is lost. Reload in a moment." }, { status: 503 });
  }
}

// Submit an ICP as a live-sourcing request. Claude fulfills it via Explorium +
// email verification and lands the results as a named list (no mock, no cost).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const filters = filtersFromBody(b && typeof b === "object" ? b : {});
  const request = await getStore().createSourcingRequest(filters);
  return NextResponse.json({ request });
}
