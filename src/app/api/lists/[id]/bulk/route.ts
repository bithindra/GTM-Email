import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

// Bulk list operations:
//   { addProspectIds?: string[], removeProspectIds?: string[], mergeFromListId?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const store = getStore();

  if (!(await store.getList(id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (Array.isArray(b.addProspectIds) && b.addProspectIds.length) {
    await store.addToList(id, b.addProspectIds);
  }
  if (b.mergeFromListId) {
    // Dedupe by email so a client already in this list (even under a different
    // prospect record / email casing) is never added twice — one entry per email.
    const [targetMembers, fromMembers] = await Promise.all([
      store.getListMembers(id),
      store.getListMembers(b.mergeFromListId),
    ]);
    const seen = new Set(targetMembers.map((m) => (m.email || "").trim().toLowerCase()).filter(Boolean));
    const toAdd: string[] = [];
    for (const m of fromMembers) {
      const email = (m.email || "").trim().toLowerCase();
      if (email) {
        if (seen.has(email)) continue; // already represented in the target list
        seen.add(email);
      }
      toAdd.push(m.id);
    }
    if (toAdd.length) await store.addToList(id, toAdd);
  }
  if (Array.isArray(b.removeProspectIds) && b.removeProspectIds.length) {
    for (const pid of b.removeProspectIds) await store.removeFromList(id, pid);
  }

  const list = await store.getList(id);
  return NextResponse.json({ ok: true, list });
}
