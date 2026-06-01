import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = new URL(req.url).searchParams.get("url") || "https://example.com";
  try {
    await getStore().recordEvent(id, "clicked");
  } catch {}
  return NextResponse.redirect(target, 302);
}
