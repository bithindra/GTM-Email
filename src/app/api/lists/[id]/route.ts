import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const list = await store.getList(id);
  if (!list) return NextResponse.json({ error: "not found" }, { status: 404 });
  const members = await store.getListMembers(id);
  return NextResponse.json({ list, members });
}
