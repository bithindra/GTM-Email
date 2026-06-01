import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Add a contact to this list (create the prospect if new, dedupe by email).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  if (!emailRe.test(email)) return NextResponse.json({ error: "valid email required" }, { status: 400 });

  const store = getStore();
  const newP: Prospect = {
    id: uuid(), name: String(b.name || "").trim() || email.split("@")[0], title: "",
    company: String(b.company || "").trim(), companySize: "", industry: "", country: "", city: "",
    linkedin: "", email, emailStatus: "unknown", createdAt: new Date().toISOString(),
  };
  await store.saveProspects([newP]);
  const all = await store.listProspects();
  const pid = all.find((p) => p.email === email)?.id;
  if (!pid) return NextResponse.json({ error: "could not save contact" }, { status: 500 });
  await store.addToList(id, [pid]);
  return NextResponse.json({ ok: true, prospectId: pid });
}

// Remove a contact from this list (the prospect stays in the DB).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prospectId = new URL(req.url).searchParams.get("prospectId");
  if (!prospectId) return NextResponse.json({ error: "prospectId required" }, { status: 400 });
  await getStore().removeFromList(id, prospectId);
  return NextResponse.json({ ok: true });
}
