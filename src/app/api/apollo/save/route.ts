import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import { enrichPeople } from "@/lib/apollo";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // revealing many emails (paginated saves) can take a while

// Reveal emails for the selected Apollo people (1 credit each), save them as
// prospects, and add to a new or existing list.
//   { prospects: [...search rows...], listName?, listId? }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const rows: Prospect[] = Array.isArray(b.prospects) ? b.prospects : [];
  if (!rows.length) return NextResponse.json({ error: "no prospects" }, { status: 400 });
  if (!b.listName && !b.listId) return NextResponse.json({ error: "listName or listId required" }, { status: 400 });

  const store = getStore();

  // Enrich (reveal emails) via Apollo
  const revealed = await enrichPeople(rows.map((r) => ({
    apolloId: r.apolloId, firstName: r.firstName, lastName: r.lastName, name: r.name, domain: r.domain, linkedin: r.linkedin, company: r.company,
  })));

  let creditsUsed = 0;
  const incoming: Prospect[] = rows.map((r, i) => {
    const key = r.apolloId || `idx_${i}`;
    const rev = revealed.get(key);
    const email = (rev?.email || r.email || "").toLowerCase();
    if (rev?.email) creditsUsed++;
    const emailStatus: Prospect["emailStatus"] = rev?.status === "verified" ? "verified" : email ? "guessed" : "unknown";
    return {
      id: uuid(),
      name: rev?.name || r.name || "",
      title: r.title || "",
      company: r.company || "",
      companySize: r.companySize || "",
      industry: r.industry || "",
      country: r.country || "",
      city: r.city || "",
      linkedin: rev?.linkedin || r.linkedin || "",
      email,
      emailStatus,
      createdAt: new Date().toISOString(),
    } as Prospect;
  }).filter((p) => p.email); // only keep those we could reveal an email for

  if (!incoming.length) {
    return NextResponse.json({ error: "no emails could be revealed for the selected people", creditsUsed });
  }

  await store.saveProspects(incoming);
  // Resolve ids by email directly (covers both newly inserted and pre-existing
  // prospects). The old listProspects() lookup was capped at 1000 rows, so on
  // larger accounts some ids silently went missing and never joined the list.
  const byEmail = await store.getProspectIdsByEmails(incoming.map((p) => p.email));
  const ids = incoming.map((p) => byEmail.get(p.email.toLowerCase())).filter((x): x is string => !!x);

  let list;
  if (b.listId) {
    await store.addToList(b.listId, ids);
    list = await store.getList(b.listId);
  } else {
    list = await store.createList(b.listName, ids, "apollo");
  }
  return NextResponse.json({ list, saved: incoming.length, creditsUsed });
}
