import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// The scraper's own internal budget is 280s; give it room to answer.
export const maxDuration = 300;

/**
 * Thin proxy to maps-lead-scraper. It exists so the browser never needs to know
 * the scraper's origin (and so the scraper can stay on a private URL later).
 */
export async function POST(req: NextRequest) {
  const base = (process.env.MAPS_SCRAPER_URL || "").replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      { error: "MAPS_SCRAPER_URL is not set — paste a CSV instead, or configure the scraper." },
      { status: 503 },
    );
  }
  const b = await req.json().catch(() => ({}));
  const query = String(b.query || "").trim();
  const maxResults = Math.min(Math.max(Number(b.maxResults) || 20, 1), 60);
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  try {
    // The scraper deployment is behind Vercel SSO. Rather than making it public,
    // pass a Protection Bypass for Automation secret when one is configured.
    const headers: Record<string, string> = { "content-type": "application/json" };
    const bypass = process.env.MAPS_SCRAPER_BYPASS;
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;

    const res = await fetch(`${base}/api/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, maxResults, withEmails: true, format: "json" }),
      signal: AbortSignal.timeout(290_000),
    });
    if (res.status === 401 || res.status === 302 || res.status === 307) {
      return NextResponse.json(
        { error: "The scraper is behind Vercel SSO. Set MAPS_SCRAPER_BYPASS, or upload a CSV instead." },
        { status: 502 },
      );
    }
    const data = await res.json().catch(() => ({ error: `scraper returned ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "scrape failed" }, { status: 504 });
  }
}
