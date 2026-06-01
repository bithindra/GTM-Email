import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import { verifyEmails } from "@/lib/emailcheck";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

// Claude fulfills a sourcing request: posts the Explorium-sourced + enriched
// contacts here. We MX-verify, import (dedupe), create a named list, and mark
// the request fulfilled. Auth: x-ingest-token.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = process.env.INGEST_TOKEN;
  if (token && req.headers.get("x-ingest-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = getStore();
  const request = await store.getSourcingRequest(id);
  if (!request) return NextResponse.json({ error: "request not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const listName: string = (b.listName || "").trim() || `Sourced — ${new Date().toLocaleDateString()}`;
  const raw: Record<string, unknown>[] = Array.isArray(b.prospects) ? b.prospects : [];

  // If Claude couldn't source anything, mark the request with a note.
  if (!raw.length) {
    await store.fulfillSourcingRequest(id, { resultListId: null, importedCount: 0, note: b.note || "No matching contacts found.", status: "rejected" });
    return NextResponse.json({ ok: true, imported: 0, note: "rejected" });
  }

  const s = (r: Record<string, unknown>, k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const seen = new Set<string>();
  const cleaned = raw.map((r) => ({
    name: s(r, "name"), title: s(r, "title"), company: s(r, "company"),
    companySize: s(r, "companySize"), industry: s(r, "industry"),
    country: s(r, "country"), city: s(r, "city"), linkedin: s(r, "linkedin"),
    email: s(r, "email").toLowerCase(), emailStatus: s(r, "emailStatus"),
  })).filter((r) => r.email && !seen.has(r.email) && seen.add(r.email));

  const { verdicts } = await verifyEmails(cleaned.map((c) => c.email), { checkMx: true });

  const incoming: Prospect[] = [];
  let noMx = 0;
  for (const c of cleaned) {
    const v = verdicts[c.email];
    if (v === "invalid_syntax") continue;
    if (v === "no_mx") noMx++;
    incoming.push({
      id: uuid(), name: c.name || c.email.split("@")[0], title: c.title, company: c.company,
      companySize: c.companySize, industry: c.industry, country: c.country, city: c.city,
      linkedin: c.linkedin, email: c.email,
      // verified only if Explorium said valid AND domain has MX
      emailStatus: v === "valid" && (c.emailStatus === "verified" || c.emailStatus === "valid") ? "verified" : v === "valid" ? "guessed" : "unknown",
      createdAt: new Date().toISOString(),
    });
  }

  await store.saveProspects(incoming);
  const all = await store.listProspects();
  const byEmail = new Map(all.map((p) => [p.email, p.id]));
  const ids = incoming.map((p) => byEmail.get(p.email)).filter((x): x is string => !!x);
  const list = await store.createList(listName, ids, "explorium");
  const note = `Imported ${incoming.length} via Explorium${noMx ? `, ${noMx} flagged (no MX)` : ""}.`;
  await store.fulfillSourcingRequest(id, { resultListId: list.id, importedCount: incoming.length, note, status: "fulfilled" });

  return NextResponse.json({ ok: true, imported: incoming.length, listId: list.id, listName: list.name, noMx });
}
