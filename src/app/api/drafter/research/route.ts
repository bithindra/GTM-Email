import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { auditWithCache, normalizeWebsite } from "@/lib/audit";
import { readLinkedIn } from "@/lib/drafter/linkedin";
import { readWebsite } from "@/lib/drafter/website";
import type { DraftAudit, Offering, ResearchResult } from "@/lib/drafter/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a Maveriko audit usually takes 15-25 s, allow the engine's full budget

const OFFERINGS: Offering[] = ["brandvibe", "maveriko", "xambaaz"];

/**
 * Gather the facts a personal email can honestly use. Each source fails on its own —
 * a blocked LinkedIn or an unreadable site still returns everything else, with a note
 * saying what was missing so the user can fill it in.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const offering = b.offering as Offering;
  if (!OFFERINGS.includes(offering)) return NextResponse.json({ error: "Pick Brand Vibe, Maveriko or XamBaaz." }, { status: 400 });
  const linkedinUrl = String(b.linkedinUrl || "").trim().slice(0, 300);
  const website = String(b.website || "").trim().slice(0, 300);
  if (!linkedinUrl && !website) return NextResponse.json({ error: "Add a LinkedIn link, a website, or both." }, { status: 400 });

  const site = normalizeWebsite(website);
  const wantAudit = offering === "maveriko" && !!site;

  const [li, web, audited] = await Promise.all([
    linkedinUrl ? readLinkedIn(linkedinUrl) : Promise.resolve(null),
    website ? readWebsite(website) : Promise.resolve(null),
    wantAudit ? auditWithCache(getStore(), [site!]).catch(() => null) : Promise.resolve(null),
  ]);

  let audit: DraftAudit | null = null;
  let auditNote = "";
  if (wantAudit) {
    const a = audited?.results?.[0];
    if (a && a.status === "ok") {
      audit = { seoScore: a.seoScore, geoScore: a.geoScore, topFix: a.topFix, topIssue: a.topIssue, reportUrl: a.reportUrl };
    } else {
      auditNote = `Couldn't audit the site${a?.error ? ` (${a.error})` : ""} — the email will offer the free check instead of quoting scores.`;
    }
  }

  const result: ResearchResult = {
    person: li?.person ?? { name: "", firstName: "", headline: "", about: "", companyHint: "" },
    linkedinBlocked: li ? li.blocked : false,
    linkedinNote: li?.note ?? "",
    company: web?.company ?? { name: "", website: site ?? "", host: "", tagline: "", hasBlog: false },
    websiteNote: web?.note ?? "",
    audit,
    auditNote,
  };
  return NextResponse.json(result);
}
