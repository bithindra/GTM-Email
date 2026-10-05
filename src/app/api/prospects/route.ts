import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prospects = await getStore().listProspects();
    return NextResponse.json({ prospects });
  } catch (e) {
    console.error("GET /api/prospects", e);
    return NextResponse.json({ error: "Couldn’t reach the database just now — nothing is lost. Reload in a moment." }, { status: 503 });
  }
}
