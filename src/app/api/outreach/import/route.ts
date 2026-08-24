import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import { verifyEmails } from "@/lib/emailcheck";
import { GEO_MAX, normalizeWebsite, qualifies, SEO_MAX } from "@/lib/audit";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

type Incoming = { name?: string; email?: string; website?: string; city?: string; category?: string; phone?: string };

/**
 * Turn audited businesses into prospects + a named list, applying the score
 * filter SERVER-SIDE. The UI shows the same filter, but the client cannot be
 * the thing that decides who receives mail — a stale page or a hand-edited
 * request must not be able to email a business we never scored.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const listName = String(b.listName || "").trim();
  const rows: Incoming[] = Array.isArray(b.businesses) ? b.businesses : [];
  const maxSeo = Number.isFinite(Number(b.maxSeo)) ? Number(b.maxSeo) : SEO_MAX;
  const maxGeo = Number.isFinite(Number(b.maxGeo)) ? Number(b.maxGeo) : GEO_MAX;
  if (!listName) return NextResponse.json({ error: "list name required" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "no businesses" }, { status: 400 });

  const store = getStore();
  const skipped = { noWebsite: 0, noEmail: 0, notAudited: 0, scoredTooWell: 0, suppressed: 0, duplicate: 0, badMx: 0 };

  // 1. Shape and dedupe.
  const seenEmail = new Set<string>();
  const candidates: { name: string; email: string; website: string; city: string; category: string; phone: string }[] = [];
  for (const r of rows) {
    const website = normalizeWebsite(r.website);
    if (!website) { skipped.noWebsite++; continue; }
    const email = String(r.email || "").trim().toLowerCase();
    if (!email) { skipped.noEmail++; continue; }
    if (seenEmail.has(email)) { skipped.duplicate++; continue; }
    seenEmail.add(email);
    candidates.push({
      name: String(r.name || "").trim(),
      email, website,
      city: String(r.city || "").trim(),
      category: String(r.category || "").trim(),
      phone: String(r.phone || "").trim(),
    });
  }

  // 2. The score gate, read from our own audit cache — never from the request.
  const audits = await store.getAuditsByWebsites([...new Set(candidates.map((c) => c.website))]);
  const gated = candidates.filter((c) => {
    const a = audits.get(c.website);
    if (!a || a.status !== "ok") { skipped.notAudited++; return false; }
    if (!qualifies(a, { maxSeo, maxGeo })) { skipped.scoredTooWell++; return false; }
    return true;
  });

  // 3. Never re-contact someone who unsubscribed or hard-bounced.
  const suppressed = await store.suppressedEmails();
  const allowed = gated.filter((c) => {
    if (suppressed.has(c.email)) { skipped.suppressed++; return false; }
    return true;
  });

  if (!allowed.length) {
    return NextResponse.json({ error: "nothing qualified", skipped }, { status: 400 });
  }

  // 4. Same MX verification every other import path uses — bad addresses are
  // marked "unknown", which the sender then refuses to attempt.
  const { verdicts } = await verifyEmails(allowed.map((c) => c.email), { checkMx: b.checkMx !== false });

  const incoming: Prospect[] = [];
  for (const c of allowed) {
    const v = verdicts[c.email];
    if (v === "invalid_syntax") { skipped.badMx++; continue; }
    if (v === "no_mx") skipped.badMx++;
    incoming.push({
      id: uuid(),
      // Maps-scraped inboxes are usually info@/contact@ with no person behind
      // them. Leave the name blank rather than inventing one — {{first_name}}
      // resolves to "there", which is honest.
      name: "",
      title: "",
      company: c.name,
      companySize: "",
      industry: c.category,
      country: "",
      city: c.city,
      linkedin: "",
      email: c.email,
      emailStatus: v === "valid" ? "verified" : "unknown",
      website: c.website,
      // Carried so a saved list can be worked by phone as well as by mail.
      phone: c.phone || "",
      createdAt: new Date().toISOString(),
    });
  }

  if (!incoming.length) return NextResponse.json({ error: "no importable rows", skipped }, { status: 400 });

  await store.saveProspects(incoming);
  // Resolve ids by email rather than scanning listProspects() — that read is
  // capped at 1000 rows and would silently drop members of a big list.
  const idByEmail = await store.getProspectIdsByEmails(incoming.map((p) => p.email));
  const ids = incoming.map((p) => idByEmail.get(p.email)).filter((x): x is string => !!x);

  // Backfill the website on prospects that already existed (saveProspects does
  // ON CONFLICT DO NOTHING, so a repeat lead keeps its original row) — without
  // this the audit merge fields would come back empty for them and the sender
  // would refuse to mail them.
  for (const p of incoming) {
    const id = idByEmail.get(p.email);
    if (id) await store.updateProspect(id, { website: p.website });
  }

  const list = await store.createList(listName, ids, "maps-audit");
  return NextResponse.json({ list, imported: ids.length, skipped, maxSeo, maxGeo });
}
