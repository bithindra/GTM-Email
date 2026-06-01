import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  const recipients = await store.getRecipients(id);
  const template = await store.getTemplate(campaign.templateId);
  return NextResponse.json({ campaign, recipients, template });
}

// Delete a campaign (and its recipients). For a scheduled campaign this is also
// how you cancel it before it sends.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  await store.deleteCampaign(id);
  return NextResponse.json({ ok: true });
}
