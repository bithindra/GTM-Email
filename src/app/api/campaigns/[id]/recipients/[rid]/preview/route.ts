import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { mergeDataFromProspect, renderTemplate, spin } from "@/lib/email";

export const dynamic = "force-dynamic";

// Exact email this specific client will receive (merge fields filled), for the
// first mail and the follow-up (if configured).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const store = getStore();
  const campaign = await store.getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  const recipient = await store.getRecipient(rid);
  if (!recipient || recipient.campaignId !== id) return NextResponse.json({ error: "recipient not found" }, { status: 404 });

  const prospects = await store.listProspects();
  const p = prospects.find((x) => x.id === recipient.prospectId);
  const data = mergeDataFromProspect(p ?? { name: recipient.name, company: recipient.company, title: "", city: "", country: "" });

  const first = await store.getTemplate(campaign.templateId);
  const followupTmpl = campaign.followupTemplateId ? await store.getTemplate(campaign.followupTemplateId) : null;

  return NextResponse.json({
    to: recipient.email,
    name: recipient.name,
    first: first ? { subject: renderTemplate(spin(first.subject, rid), data), body: renderTemplate(spin(first.body, rid), data) } : null,
    followup: followupTmpl ? { subject: renderTemplate(spin(followupTmpl.subject, rid), data), body: renderTemplate(spin(followupTmpl.body, rid), data), days: campaign.followupDays } : null,
  });
}
