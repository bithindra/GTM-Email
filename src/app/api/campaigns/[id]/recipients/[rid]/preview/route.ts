import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { hasUnresolvedMerge, mergeDataFromProspect, renderTemplate, spin } from "@/lib/email";

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
  // Compose exactly the way sender.ts does, audit data included — a preview that
  // omitted it would show blanks for an audit mail the sender renders in full.
  const audits = p?.website ? await store.getAuditsByWebsites([p.website]) : new Map();
  const data = mergeDataFromProspect(
    p ?? { name: recipient.name, company: recipient.company, title: "", city: "", country: "" },
    p?.website ? audits.get(p.website) : null,
  );

  const first = await store.getTemplate(campaign.templateId);
  const followupTmpl = campaign.followupTemplateId ? await store.getTemplate(campaign.followupTemplateId) : null;

  // Same gate the sender applies, surfaced here so the operator finds out at
  // preview time — not by discovering the recipient was silently skipped.
  const render = (t: { subject: string; body: string }) => {
    const subject = renderTemplate(spin(t.subject, rid), data);
    const body = renderTemplate(spin(t.body, rid), data);
    const blocked = hasUnresolvedMerge(t.subject, subject, data) ?? hasUnresolvedMerge(t.body, body, data);
    return { subject, body, blocked };
  };

  return NextResponse.json({
    to: recipient.email,
    name: recipient.name,
    first: first ? render(first) : null,
    followup: followupTmpl ? { ...render(followupTmpl), days: campaign.followupDays } : null,
  });
}
