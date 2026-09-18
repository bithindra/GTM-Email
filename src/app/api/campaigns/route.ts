import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { isSendTz } from "@/lib/send-window";

export const dynamic = "force-dynamic";

export async function GET() {
  const campaigns = await getStore().getCampaigns();
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const store = getStore();

  // Targets can come from explicit prospectIds[], a single listId, or many listIds[] (deduped union).
  let prospectIds: string[] = Array.isArray(b.prospectIds) ? b.prospectIds : [];
  const listIds: string[] = Array.isArray(b.listIds) ? b.listIds : (b.listId ? [b.listId] : []);
  if (listIds.length) {
    const seen = new Set(prospectIds);
    for (const lid of listIds) {
      const members = await store.getListMembers(lid);
      for (const m of members) if (!seen.has(m.id)) { seen.add(m.id); prospectIds.push(m.id); }
    }
  }

  if (!b.name || !b.templateId || prospectIds.length === 0) {
    return NextResponse.json({ error: "name, templateId and a non-empty prospectIds[] or listId are required" }, { status: 400 });
  }
  // Optional schedule; ignore past timestamps (treat as send-now / draft).
  let scheduledAt: string | null = null;
  if (b.scheduledAt) {
    const t = new Date(b.scheduledAt);
    if (!isNaN(t.getTime()) && t.getTime() > Date.now()) scheduledAt = t.toISOString();
  }

  // Optional attachments: [{ filename, contentType, content(base64) }]. Cap total
  // decoded size at ~20MB to stay under Gmail's 25MB limit and keep DB rows sane.
  const rawAttachments = Array.isArray(b.attachments) ? b.attachments : [];
  const attachments = rawAttachments
    .filter((a: unknown): a is { filename: string; contentType?: string; content: string } =>
      !!a && typeof (a as { filename?: unknown }).filename === "string" && typeof (a as { content?: unknown }).content === "string")
    .slice(0, 10)
    .map((a: { filename: string; contentType?: string; content: string }) => ({
      filename: a.filename,
      contentType: a.contentType || "application/octet-stream",
      content: a.content,
    }));
  const totalBytes = attachments.reduce((s: number, a: { content: string }) => s + Math.floor(a.content.length * 0.75), 0);
  if (totalBytes > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Attachments exceed 20MB total. Use a shared link for larger files." }, { status: 400 });
  }

  const c = await store.createCampaign(
    b.name,
    b.templateId,
    prospectIds,
    b.followupTemplateId || null,
    typeof b.followupDays === "number" ? b.followupDays : 7,
    scheduledAt,
    attachments,
    b.followup2TemplateId || null,
    typeof b.followup2Days === "number" ? b.followup2Days : 7,
    typeof b.fromMailbox === "string" && b.fromMailbox ? b.fromMailbox : null,
    // Only a listed zone is stored; anything else falls back to the home zone.
    isSendTz(b.sendTz) ? b.sendTz : null,
  );
  return NextResponse.json({ campaign: c });
}
