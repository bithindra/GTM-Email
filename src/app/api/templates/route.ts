import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const category = new URL(req.url).searchParams.get("category");
  const all = await getStore().getTemplates();
  const templates = category ? all.filter((t) => (t.category || "") === category) : all;
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.subject || !b.body) {
    return NextResponse.json({ error: "name, subject and body are required" }, { status: 400 });
  }
  const format: "plain" | "rich" | "newsletter" =
    b.format === "plain" || b.format === "rich" || b.format === "newsletter"
      ? b.format
      : b.type === "newsletter" ? "newsletter" : "rich";
  const type = format === "newsletter" ? "newsletter" : "outreach";
  const track = typeof b.track === "boolean" ? b.track : format !== "plain";
  const category = typeof b.category === "string" && b.category.trim() ? b.category.trim() : null;
  const t = await getStore().saveTemplate({ id: b.id, name: b.name, subject: b.subject, body: b.body, type, format, track, category });
  return NextResponse.json({ template: t });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await getStore().deleteTemplate(id);
  return NextResponse.json({ ok: true });
}
