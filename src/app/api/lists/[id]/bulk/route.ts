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
    const members = await store.getListMembers(b.mergeFromListId);
    await store.addToList(id, members.map((m) => m.id));
  }
  if (Array.isArray(b.removeProspectIds) && b.removeProspectIds.length) {
    for (const pid of b.removeProspectIds) await store.removeFromList(id, pid);
  }

  const list = await store.getList(id);
  return NextResponse.json({ ok: true, list });
}
