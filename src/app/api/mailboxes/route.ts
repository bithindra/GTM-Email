import { NextResponse } from "next/server";
import { publicMailboxes } from "@/lib/mailboxes";

export const dynamic = "force-dynamic";

// Available sending mailboxes for the "Send from" dropdown. Returns id + label only.
export async function GET() {
  return NextResponse.json({ mailboxes: publicMailboxes() });
}
