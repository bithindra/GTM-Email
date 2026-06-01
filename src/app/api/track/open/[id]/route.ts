import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await getStore().recordEvent(id, "opened");
  } catch {}
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}
