import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Claude-sync ingest endpoint.
 * Claude calls Apollo via MCP, transforms results, and POSTs them here to land
 * live founders in the Neon DB — no Apollo API key required in the app itself.
 *
 * Auth: send header `x-ingest-token: <INGEST_TOKEN>`. If INGEST_TOKEN is unset,
 * the endpoint is disabled in production for safety.
 */
function bandFromCount(n?: number): string {
  if (!n) return "—";
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  return "1001-5000";
}

export async function POST(req: NextRequest) {
  const token = process.env.INGEST_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "ingest disabled (no INGEST_TOKEN set)" }, { status: 403 });
    }
  } else if (req.headers.get("x-ingest-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const b = await req.json().catch(() => ({}));
  const raw: Record<string, unknown>[] = Array.isArray(b) ? b : b.prospects ?? [];
  if (!raw.length) return NextResponse.json({ error: "prospects[] required" }, { status: 400 });

  const prospects: Prospect[] = raw.map((p) => {
    const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    const size = s("companySize") || bandFromCount(p.estimatedNumEmployees as number | undefined);
    return {
      id: s("id") || uuid(),
      name: s("name"),
      title: s("title"),
      company: s("company"),
      companySize: size,
      industry: s("industry"),
      country: s("country"),
      city: s("city"),
      linkedin: s("linkedin"),
      email: s("email"),
      emailStatus: (s("emailStatus") as Prospect["emailStatus"]) || (s("email") ? "guessed" : "unknown"),
      createdAt: new Date().toISOString(),
    };
  }).filter((p) => p.name);

  const added = await getStore().saveProspects(prospects);
  return NextResponse.json({ received: prospects.length, added: added.length });
}
