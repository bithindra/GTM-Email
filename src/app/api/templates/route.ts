import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const templates = await getStore().getTemplates();
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.subject || !b.body) {
    return NextResponse.json({ error: "name, subject and body are required" }, { status: 400 });
  }
  const t = await getStore().saveTemplate({ id: b.id, name: b.name, subject: b.subject, body: b.body });
  return NextResponse.json({ template: t });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await getStore().deleteTemplate(id);
  return NextResponse.json({ ok: true });
}
