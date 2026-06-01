import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const patch: Partial<Prospect> = {};
  if (typeof b.name === "string") patch.name = b.name.trim();
  if (typeof b.company === "string") patch.company = b.company.trim();
  if (typeof b.title === "string") patch.title = b.title.trim();
  if (typeof b.email === "string") {
    const email = b.email.trim().toLowerCase();
    if (!emailRe.test(email)) return NextResponse.json({ error: "invalid email" }, { status: 400 });
    patch.email = email;
    patch.emailStatus = "unknown";
  }
  const updated = await getStore().updateProspect(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ prospect: updated });
}
