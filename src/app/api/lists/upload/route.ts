import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import { verifyEmails } from "@/lib/emailcheck";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

// Create prospects from uploaded client rows and save them as a named list.
//   { name: "EdTech Clients", rows: [{ name, company, email }, ...], checkMx?: true }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const listName: string = (b.name || "").trim();
  const rows: Record<string, unknown>[] = Array.isArray(b.rows) ? b.rows : [];
  if (!listName) return NextResponse.json({ error: "list name required" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "no rows" }, { status: 400 });

  const store = getStore();
  const seen = new Set<string>();
  let duplicates = 0;
  const cleaned: { name: string; company: string; email: string }[] = [];

  for (const r of rows) {
    const get = (...keys: string[]) => {
      for (const k of Object.keys(r)) {
        const norm = k.toLowerCase().replace(/[^a-z]/g, "");
        if (keys.includes(norm)) return String((r as Record<string, unknown>)[k] ?? "").trim();
      }
      return "";
    };
    const email = get("email", "emailid", "emailaddress", "mail").toLowerCase();
    const name = get("name", "clientname", "contactname", "fullname", "client");
    const company = get("company", "companyname", "organisation", "organization", "org");
    if (!email) continue;
    if (seen.has(email)) { duplicates++; continue; }
    seen.add(email);
    cleaned.push({ name: name || email.split("@")[0], company, email });
  }

  // Correctness check: syntax + MX-domain verification.
  const { verdicts, summary } = await verifyEmails(cleaned.map((c) => c.email), { checkMx: b.checkMx !== false });

  const incoming: Prospect[] = [];
  const rejected: { email: string; reason: string }[] = [];
  for (const c of cleaned) {
    const v = verdicts[c.email];
    if (v === "invalid_syntax") { rejected.push({ email: c.email, reason: "invalid format" }); continue; }
    incoming.push({
      id: uuid(), name: c.name, title: "", company: c.company, companySize: "", industry: "",
      country: "", city: "", linkedin: "", email: c.email,
      emailStatus: v === "valid" ? "verified" : "unknown", // unknown = no MX record found
      createdAt: new Date().toISOString(),
    });
    if (v === "no_mx") rejected.push({ email: c.email, reason: "no mail server (MX) for domain" });
  }

  if (!incoming.length) {
    return NextResponse.json({ error: "no importable rows", summary, duplicates, rejected }, { status: 400 });
  }

  await store.saveProspects(incoming);
  const all = await store.listProspects();
  const byEmail = new Map(all.map((p) => [p.email, p.id]));
  const ids = incoming.map((p) => byEmail.get(p.email)).filter((x): x is string => !!x);

  const list = await store.createList(listName, ids, "upload");
  return NextResponse.json({
    list,
    imported: incoming.length,
    duplicates,
    invalidSyntax: summary.invalid_syntax,
    noMx: summary.no_mx,
    rejected,
  });
}
