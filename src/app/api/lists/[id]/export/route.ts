import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getStore } from "@/lib/db";
import { normalizeWebsite } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Download one list as an .xlsx — every contact with every stored detail, so the list
 * can be mailed from another tool or worked by phone.
 *
 * Built server-side and returned as a file, so both the Lists page and a list's own
 * page use a plain download link and the browser never loads the members twice.
 *
 * Two additions beyond the raw contact fields:
 *  - Audit columns (SEO/AI scores, top issue, report link) when the list came from Audit
 *    Outreach. Omitted entirely for lists with no audited site, so an Apollo list does
 *    not ship eight empty columns.
 *  - "Do not email" for anyone unsubscribed or hard-bounced. A spreadsheet leaves this
 *    app's suppression list behind — without the flag, the export is how an unsubscribed
 *    person gets mailed again.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const list = await store.getList(id);
  if (!list) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [members, suppressed] = await Promise.all([store.getListMembers(id), store.suppressedEmails()]);

  const siteOf = new Map(members.map((m) => [m.id, normalizeWebsite(m.website)]));
  const sites = [...new Set([...siteOf.values()].filter((w): w is string => !!w))];
  const audits = sites.length ? await store.getAuditsByWebsites(sites) : new Map();
  const hasAudits = [...audits.values()].some((a) => a.status === "ok");

  const date = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

  const rows = members.map((m) => {
    const row: Record<string, string | number> = {
      Name: m.name || "",
      Title: m.title || "",
      Company: m.company || "",
      Email: m.email || "",
      "Email status": m.emailStatus || "",
      "Do not email": m.email && suppressed.has(m.email.toLowerCase()) ? "yes" : "",
      Phone: m.phone || "",
      Website: m.website || "",
      Industry: m.industry || "",
      "Company size": m.companySize || "",
      City: m.city || "",
      Country: m.country || "",
      LinkedIn: m.linkedin || "",
      "Added on": date(m.createdAt),
    };
    if (hasAudits) {
      const site = siteOf.get(m.id);
      const a = site ? audits.get(site) : undefined;
      const ok = a && a.status === "ok";
      row["SEO score"] = ok && a.seoScore !== null ? a.seoScore : "";
      row["AI/GEO score"] = ok && a.geoScore !== null ? a.geoScore : "";
      row["SEO band"] = ok ? a.seoBand : "";
      row["GEO band"] = ok ? a.geoBand : "";
      row["Top issue"] = ok ? a.topIssue : "";
      row["Top fix"] = ok ? a.topFix : "";
      row["Report URL"] = ok ? a.reportUrl : "";
      row["Audited on"] = ok ? date(a.checkedAt) : "";
    }
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // Readable column widths: size each to its longest value, capped so one long cell
  // (a top-fix sentence, a report URL) cannot stretch a column across the screen.
  const headers = rows.length ? Object.keys(rows[0]) : ["Name", "Company", "Email", "Phone"];
  ws["!cols"] = headers.map((h) => ({
    wch: Math.min(48, Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length)) + 2),
  }));
  if (rows.length) ws["!autofilter"] = { ref: ws["!ref"] as string };

  const wb = XLSX.utils.book_new();
  // Sheet names are capped at 31 chars and cannot contain : \ / ? * [ ]
  XLSX.utils.book_append_sheet(wb, ws, (list.name.replace(/[:\\/?*[\]]/g, " ").trim() || "Contacts").slice(0, 31));
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const base = `${list.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "list"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // ASCII fallback plus the UTF-8 name, so a list called "Pune — dentists" keeps its name.
      "Content-Disposition": `attachment; filename="${base}"; filename*=UTF-8''${encodeURIComponent(`${list.name}_${new Date().toISOString().slice(0, 10)}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}
