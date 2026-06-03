import { v4 as uuid } from "uuid";
import type { Prospect, SearchFilters } from "./types";
import { generateMockProspects } from "./mockData";
import { REVENUE_BANDS } from "./filters";

const SIZE_MAP: Record<string, string> = {
  "1-10": "1,10", "11-50": "11,50", "51-200": "51,200",
  "201-500": "201,500", "501-1000": "501,1000", "1001-5000": "1001,5000",
};

// A few role chips map to several real-world title variants so Apollo returns
// the actual decision-makers, not just literal-string matches. Chips not listed
// here (Founder, CEO, …) pass through unchanged.
const TITLE_SYNONYMS: Record<string, string[]> = {
  "CFO": ["CFO", "Chief Financial Officer", "Head of Finance", "VP of Finance", "Finance Director", "Financial Controller"],
  "Marketing Head": ["Head of Marketing", "Marketing Head", "Chief Marketing Officer", "CMO", "VP of Marketing", "VP Marketing", "Marketing Director", "Growth Lead"],
  "HR Head": ["Head of HR", "Head of Human Resources", "HR Head", "Chief Human Resources Officer", "CHRO", "CHRO/CPO", "VP of Human Resources", "HR Director", "Head of People", "People Operations Lead"],
};

function expandTitles(titles: string[]): string[] {
  const out = new Set<string>();
  for (const t of titles) {
    const syn = TITLE_SYNONYMS[t];
    if (syn) syn.forEach((s) => out.add(s));
    else out.add(t);
  }
  return [...out];
}

function bandFromCount(n?: number): string {
  if (!n) return "";
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  return "1001-5000";
}

const API = "https://api.apollo.io/api/v1";

type ApolloPerson = {
  id?: string; name?: string; first_name?: string; last_name?: string; title?: string;
  linkedin_url?: string; email?: string; email_status?: string; city?: string; state?: string; country?: string;
  organization?: { name?: string; estimated_num_employees?: number; industry?: string; primary_domain?: string };
};

function mapPerson(p: ApolloPerson): Prospect {
  const fullName = p.name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return {
    id: uuid(),
    apolloId: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    name: fullName,
    title: p.title || "",
    company: p.organization?.name || "",
    companySize: bandFromCount(p.organization?.estimated_num_employees),
    industry: p.organization?.industry || "",
    country: p.country || "",
    city: [p.city, p.state].filter(Boolean).join(", "),
    linkedin: p.linkedin_url || "",
    domain: p.organization?.primary_domain || "",
    email: p.email && !/email_not_unlocked/i.test(p.email) ? p.email : "",
    emailStatus: p.email_status === "verified" ? "verified" : "unknown",
    createdAt: new Date().toISOString(),
  };
}

// Live discovery via Apollo's people api_search. Returns people (emails masked —
// revealed later via enrichPeople). Falls back to mock only if no key.
export async function searchProspects(filters: SearchFilters): Promise<{ source: "apollo" | "mock"; prospects: Prospect[]; error?: string; note?: string }> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { source: "mock", prospects: generateMockProspects(filters) };

  const body: Record<string, unknown> = {
    person_titles: filters.titles.length ? expandTitles(filters.titles) : ["Founder", "CEO", "Owner"],
    person_locations: filters.countries,
    organization_num_employees_ranges: filters.sizes.map((s) => SIZE_MAP[s]).filter(Boolean),
    q_keywords: filters.keywords || undefined,
    page: 1,
    per_page: 100, // Apollo's max page size; we paginate below to reach `target`
  };
  if (filters.industries.length) body.q_organization_keyword_tags = filters.industries;
  if (filters.seniorities?.length) body.person_seniorities = filters.seniorities;
  if (filters.revenueRanges?.length) {
    const bands = REVENUE_BANDS.filter((b) => filters.revenueRanges!.includes(b.label));
    if (bands.length) {
      const min = Math.min(...bands.map((b) => b.min));
      const openEnded = bands.some((b) => b.max == null);
      const max = openEnded ? undefined : Math.max(...bands.map((b) => b.max as number));
      body.revenue_range = { min, ...(max != null ? { max } : {}) };
    }
  }

  async function call(b: Record<string, unknown>) {
    const res = await fetch(`${API}/mixed_people/api_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": key as string },
      body: JSON.stringify(b),
    });
    return res.json();
  }

  // How many people to pull in total (paginated 100 at a time). Capped at 1000.
  const target = Math.min(filters.limit || 25, 1000);

  try {
    let note: string | undefined;
    // Page 1 — also handles the "advanced filter needs a higher plan" retry.
    let data = await call({ ...body, page: 1 });
    const errStr = String(data.error || data.error_code || "");
    if (errStr && /advanced filter|revenue_range|not.*access/i.test(errStr)) {
      const dropped: string[] = [];
      if (body.revenue_range) { delete body.revenue_range; dropped.push("revenue"); }
      if (body.person_seniorities && /senior/i.test(errStr)) { delete body.person_seniorities; dropped.push("seniority"); }
      data = await call({ ...body, page: 1 });
      if (dropped.length) note = `${dropped.join(" & ")} filter needs a higher Apollo plan — ignored.`;
    }
    if (data.error || data.error_code) return { source: "apollo", prospects: [], error: data.error || data.error_code };

    const collected: ApolloPerson[] = [...((data.people ?? data.contacts ?? []) as ApolloPerson[])];
    const maxPages = Math.ceil(target / 100);
    // Fetch additional pages until we hit the target or run out of results.
    for (let page = 2; collected.length < target && page <= maxPages; page++) {
      const more = await call({ ...body, page });
      const people: ApolloPerson[] = more.people ?? more.contacts ?? [];
      if (!people.length) break;
      collected.push(...people);
      if (people.length < 100) break; // last page
    }
    return { source: "apollo", prospects: collected.slice(0, target).map(mapPerson), note };
  } catch (e) {
    return { source: "apollo", prospects: [], error: (e as Error).message };
  }
}

// Reveal verified emails for selected people (1 credit per match). Up to 10 per call.
export async function enrichPeople(
  items: { apolloId?: string; firstName?: string; lastName?: string; name?: string; domain?: string; linkedin?: string; company?: string }[],
): Promise<Map<string, { email: string; name: string; status: string; linkedin: string }>> {
  const key = process.env.APOLLO_API_KEY;
  const out = new Map<string, { email: string; name: string; status: string; linkedin: string }>();
  if (!key || items.length === 0) return out;
  const apiKey: string = key;

  // Build the 10-per-call chunks, then run them with bounded concurrency.
  // Sequential reveal made large saves (250-1000) run for minutes and time out;
  // 5 chunks in parallel cuts that ~5x while staying within Apollo rate limits.
  const chunks: { start: number; items: typeof items }[] = [];
  for (let i = 0; i < items.length; i += 10) chunks.push({ start: i, items: items.slice(i, i + 10) });

  async function runChunk(c: { start: number; items: typeof items }) {
    const details = c.items.map((it, idx) => ({
      id: it.apolloId || `idx_${c.start + idx}`,
      first_name: it.firstName,
      last_name: it.lastName,
      name: it.name,
      domain: it.domain || undefined,
      organization_name: it.company || undefined,
      linkedin_url: it.linkedin || undefined,
    }));
    try {
      const res = await fetch(`${API}/people/bulk_match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": apiKey },
        body: JSON.stringify({ details }),
      });
      const data = await res.json();
      const matches: ApolloPerson[] = data.matches ?? [];
      matches.forEach((m, idx) => {
        const reqId = details[idx]?.id;
        if (!reqId || !m) return;
        out.set(reqId, {
          email: m.email && !/email_not_unlocked/i.test(m.email) ? m.email : "",
          name: m.name || "",
          status: m.email_status || "unknown",
          linkedin: m.linkedin_url || "",
        });
      });
    } catch {
      // skip chunk on error
    }
  }

  // Sequential — Apollo rate-limits bursts of bulk_match calls. Large saves are
  // kept fast/safe by chunking on the client (each request reveals a small batch).
  for (const c of chunks) await runChunk(c);
  return out;
}
