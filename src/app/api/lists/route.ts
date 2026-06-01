import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const lists = await getStore().getLists();
  return NextResponse.json({ lists });
}

// Save a named list from already-existing prospect ids (e.g. a culled search/saved set).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !Array.isArray(b.prospectIds) || b.prospectIds.length === 0) {
    return NextResponse.json({ error: "name and prospectIds[] are required" }, { status: 400 });
  }
  const list = await getStore().createList(b.name, b.prospectIds, b.source || "manual");
  return NextResponse.json({ list });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await getStore().deleteList(id);
  return NextResponse.json({ ok: true });
}
