import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const prospects = await getStore().listProspects();
  return NextResponse.json({ prospects });
}
