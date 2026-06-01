import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Manual / programmatic status update. Replies are detected out-of-band
// (inbound mailbox / IMAP poll) and reported here, or set manually from the UI.
const ALLOWED = ["delivered", "opened", "clicked", "replied", "bounced"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const type = b.type;
  if (!ALLOWED.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }
  await getStore().recordEvent(id, type);
  return NextResponse.json({ ok: true });
}
