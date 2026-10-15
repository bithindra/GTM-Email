import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { hasUnresolvedMerge, isPersonal, mergeDataFromProspect, renderTemplate, spin, withOptOut } from "@/lib/email";
import { normalizeWebsite } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * The exact email one scraped business would get from a template — their real audit
 * numbers merged in, composed the way sender.ts composes it — so Audit Outreach can
 * show it before anything is saved or sent. Read-only.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const templateId = String(b.templateId || "");
  const biz = (b.business && typeof b.business === "object" ? b.business : {}) as { name?: string; website?: string; city?: string };
  const website = normalizeWebsite(String(biz.website || ""));
  if (!templateId || !website) return NextResponse.json({ error: "Pick a mail and a business with a website." }, { status: 400 });

  try {
    const store = getStore();
    const template = await store.getTemplate(templateId);
    if (!template) return NextResponse.json({ error: "That mail no longer exists." }, { status: 404 });
    const audit = (await store.getAuditsByWebsites([website])).get(website) ?? null;
    // Maps inboxes are info@/contact@: no person's name, exactly as the import stores it.
    const data = mergeDataFromProspect({ name: "", company: String(biz.name || ""), title: "", city: String(biz.city || ""), country: "" }, audit);
    const seed = website; // stable per business, like the recipient id in the sender
    const subject = renderTemplate(spin(template.subject, seed), data);
    const body = withOptOut(renderTemplate(spin(template.body, seed), data), isPersonal(template));
    const blocked = hasUnresolvedMerge(template.subject, subject, data) ?? hasUnresolvedMerge(template.body, body, data);
    return NextResponse.json({ subject, body, blocked });
  } catch {
    return NextResponse.json({ error: "Couldn't build the preview just now — try again." }, { status: 503 });
  }
}
