"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Loader2, MapPin, Upload, ScanSearch, Rocket, ExternalLink, RefreshCw, Download } from "lucide-react";
import type { AuditRecord, List } from "@/lib/types";
import { GEO_MAX, SEO_MAX } from "@/lib/audit";
import CampaignModal from "@/components/CampaignModal";

// Everything the Maps scraper gives us. Phone/address/rating/mapsUrl are not used by
// the email flow, but they are the whole point of a saved list you intend to CALL from,
// so they are carried through and exported rather than dropped at the mapping step.
type Business = {
  name: string;
  website: string;
  email: string;
  city: string;
  category: string;
  phone: string;
  address: string;
  rating: string;
  reviews: string;
  mapsUrl: string;
};

/** Websites are audited in batches so the browser sees steady progress instead
 *  of one request that looks hung for ten minutes. */
const AUDIT_BATCH = 8;

function pickCol(keys: string[], ...candidates: string[]) {
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, "");
    if (candidates.includes(norm)) return k;
  }
  return null;
}

function scoreClass(v: number | null, max: number) {
  if (v === null) return "text-slate-400";
  return v < max ? "text-rose-600 font-semibold" : "text-slate-500";
}

export default function OutreachPage() {
  const [tab, setTab] = useState<"maps" | "file">("maps");
  const [query, setQuery] = useState("");
  const [maxResults, setMaxResults] = useState(20);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [audits, setAudits] = useState<Record<string, AuditRecord>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [maxSeo, setMaxSeo] = useState(SEO_MAX);
  const [maxGeo, setMaxGeo] = useState(GEO_MAX);
  const [listName, setListName] = useState("");
  const [createdList, setCreatedList] = useState<List | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ---------------- 1. Source ---------------- */

  async function runScrape() {
    if (!query.trim()) return;
    setBusy("scrape"); setNote(""); setCreatedList(null);
    try {
      const res = await fetch("/api/outreach/scrape", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, maxResults }),
      });
      const d = await res.json();
      if (!res.ok) { setNote(d.error || "Scrape failed."); return; }
      const rows: Business[] = (d.businesses ?? []).map((b: Record<string, unknown>) => ({
        name: String(b.name || ""),
        website: String(b.website || ""),
        email: (Array.isArray(b.emails) ? String(b.emails[0] ?? "") : "").toLowerCase(),
        city: "",
        category: String(b.category || ""),
        phone: String(b.phone || ""),
        address: String(b.address || ""),
        rating: String(b.rating || ""),
        reviews: String(b.reviews || ""),
        mapsUrl: String(b.mapsUrl || ""),
      }));
      setBusinesses(rows);
      setAudits({});
      if (!listName) setListName(query.trim());
      setNote(`Found ${rows.length} businesses — ${rows.filter((r) => r.email && r.website).length} have both a website and an email.`);
    } finally { setBusy(""); }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNote(""); setCreatedList(null);
    if (!listName) setListName(file.name.replace(/\.(csv|xlsx?|tsv)$/i, ""));
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        if (!json.length) { setNote("That file has no rows."); return; }
        const keys = Object.keys(json[0]);
        const nameCol = pickCol(keys, "name", "business", "businessname", "company", "companyname");
        const siteCol = pickCol(keys, "website", "url", "site", "web", "websiteurl", "domain");
        const mailCol = pickCol(keys, "emails", "email", "emailid", "emailaddress", "mail");
        const cityCol = pickCol(keys, "city", "town", "locality");
        const catCol = pickCol(keys, "category", "type", "businesstype", "industry");
        const phoneCol = pickCol(keys, "phone", "phonenumber", "mobile", "contact", "contactnumber", "tel");
        const addrCol = pickCol(keys, "address", "fulladdress", "location", "street");
        const ratingCol = pickCol(keys, "rating", "stars", "score");
        const reviewsCol = pickCol(keys, "reviews", "reviewcount", "numreviews", "totalreviews");
        const mapsCol = pickCol(keys, "mapsurl", "maps", "googlemaps", "mapslink");
        if (!siteCol || !mailCol) {
          setNote("Couldn't find a Website and an Emails column. A CSV from the Maps scraper has both.");
          return;
        }
        const rows: Business[] = json.map((r) => ({
          name: String(nameCol ? r[nameCol] : "").trim(),
          website: String(r[siteCol] ?? "").trim(),
          // The scraper joins multiple addresses with "; " — take the first.
          email: String(r[mailCol] ?? "").split(/[;,]/)[0].trim().toLowerCase(),
          city: String(cityCol ? r[cityCol] : "").trim(),
          category: String(catCol ? r[catCol] : "").trim(),
          phone: String(phoneCol ? r[phoneCol] : "").trim(),
          address: String(addrCol ? r[addrCol] : "").trim(),
          rating: String(ratingCol ? r[ratingCol] : "").trim(),
          reviews: String(reviewsCol ? r[reviewsCol] : "").trim(),
          mapsUrl: String(mapsCol ? r[mapsCol] : "").trim(),
        }));
        setBusinesses(rows);
        setAudits({});
        setNote(`Loaded ${rows.length} rows — ${rows.filter((r) => r.email && r.website).length} have both a website and an email.`);
      } catch {
        setNote("Couldn't read that file.");
      }
    };
    reader.readAsBinaryString(file);
  }

  /* ---------------- 2. Audit ---------------- */

  const auditable = useMemo(
    () => [...new Set(businesses.filter((b) => b.website && b.email).map((b) => b.website))],
    [businesses],
  );

  async function runAudits(force = false) {
    const todo = force ? auditable : auditable.filter((w) => !lookup(w));
    if (!todo.length) { setNote("Nothing left to audit."); return; }
    setBusy("audit"); setNote("");
    setProgress({ done: 0, total: todo.length });
    try {
      for (let i = 0; i < todo.length; i += AUDIT_BATCH) {
        const slice = todo.slice(i, i + AUDIT_BATCH);
        const res = await fetch("/api/outreach/audit", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ websites: slice }),
        });
        const d = await res.json();
        if (!res.ok) { setNote(d.error || "Audit failed."); break; }
        setAudits((prev) => {
          const next = { ...prev };
          for (const a of (d.results ?? []) as AuditRecord[]) next[a.host] = a;
          return next;
        });
        setProgress({ done: Math.min(i + AUDIT_BATCH, todo.length), total: todo.length });
      }
    } finally { setBusy(""); }
  }

  /** Audits come back keyed by host; a row's raw website string may carry www,
   *  a path or a scheme, so match on the host. */
  function lookup(website: string): AuditRecord | undefined {
    try {
      const h = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
        .hostname.toLowerCase().replace(/^www\./, "");
      return audits[h];
    } catch { return undefined; }
  }

  /* ---------------- 3. Filter ---------------- */

  const buckets = useMemo(() => {
    const b = { qualified: [] as Business[], noWebsite: 0, noEmail: 0, notAudited: 0, auditFailed: 0, scoredTooWell: 0 };
    for (const row of businesses) {
      if (!row.website) { b.noWebsite++; continue; }
      if (!row.email) { b.noEmail++; continue; }
      const a = lookup(row.website);
      if (!a) { b.notAudited++; continue; }
      if (a.status !== "ok" || a.seoScore === null || a.geoScore === null) { b.auditFailed++; continue; }
      if (!(a.seoScore < maxSeo && a.geoScore < maxGeo)) { b.scoredTooWell++; continue; }
      b.qualified.push(row);
    }
    return b;
  }, [businesses, audits, maxSeo, maxGeo]);

  /* ---------------- 4. Launch ---------------- */

  async function createList() {
    if (!listName.trim() || !buckets.qualified.length) return;
    setBusy("import"); setNote("");
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listName: listName.trim(), businesses: buckets.qualified, maxSeo, maxGeo }),
      });
      const d = await res.json();
      if (!res.ok) { setNote(d.error || "Import failed."); return; }
      setCreatedList(d.list);
      setImportedCount(d.imported);
    } finally { setBusy(""); }
  }

  /* ---------------- Save the full list ---------------- */

  // Export EVERY business found — not just the mail-qualified ones. A business with a
  // phone but no email is useless to the mailer and perfectly good to call, so filtering
  // here would throw away the leads this export exists to keep. Audit columns are filled
  // in when a scan has run and left blank when it hasn't, so this works before or after
  // Step 2 and the file has the same shape either way.
  function downloadCsv() {
    if (!businesses.length) return;
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Name", "Phone", "Email", "Website", "Address", "City", "Category", "Rating", "Reviews",
      "Maps URL", "SEO score", "AI/GEO score", "SEO band", "GEO band", "Top issue", "Top fix",
      "Report URL", "Audit status", "Qualified",
    ].join(",");
    const qualifiedSet = new Set(buckets.qualified.map((b) => b.website));
    const rows = businesses.map((b) => {
      const a = b.website ? lookup(b.website) : undefined;
      return [
        esc(b.name), esc(b.phone), esc(b.email), esc(b.website), esc(b.address), esc(b.city),
        esc(b.category), esc(b.rating), esc(b.reviews), esc(b.mapsUrl),
        esc(a?.seoScore ?? ""), esc(a?.geoScore ?? ""), esc(a?.seoBand ?? ""), esc(a?.geoBand ?? ""),
        esc(a?.topIssue ?? ""), esc(a?.topFix ?? ""), esc(a?.reportUrl ?? ""),
        esc(a ? (a.status === "ok" ? "ok" : a.error || "failed") : "not audited"),
        esc(b.website && qualifiedSet.has(b.website) ? "yes" : "no"),
      ].join(",");
    });
    // BOM so Excel opens UTF-8 business names correctly instead of mojibake.
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `${(listName || query || "leads").replace(/[^\w.-]+/g, "_")}_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const scanned = Object.keys(audits).length;
  const withPhone = businesses.filter((b) => b.phone).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Outreach</h1>
        <p className="text-slate-500 mt-1 max-w-3xl">
          Find local businesses, score their websites with Maveriko, and mail only the ones
          that genuinely need help — each email quotes that business&apos;s own real numbers
          and links to their own free report.
        </p>
      </div>

      {/* 1 — Source */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="badge">Step 1</span>
          <h2 className="font-semibold">Find businesses</h2>
        </div>
        <div className="flex gap-2">
          <button className={tab === "maps" ? "chip chip-active" : "chip"} onClick={() => setTab("maps")}>
            <MapPin className="w-3.5 h-3.5 inline mr-1" /> Google Maps
          </button>
          <button className={tab === "file" ? "chip chip-active" : "chip"} onClick={() => setTab("file")}>
            <Upload className="w-3.5 h-3.5 inline mr-1" /> Upload a CSV
          </button>
        </div>

        {tab === "maps" ? (
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="input flex-1 min-w-[280px]"
              placeholder='e.g. "dental clinics in Pune"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runScrape()}
            />
            <input
              className="input w-24" type="number" min={1} max={60} value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
            />
            <button className="btn btn-primary" onClick={runScrape} disabled={!!busy || !query.trim()}>
              {busy === "scrape" ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
              {busy === "scrape" ? "Searching…" : "Search"}
            </button>
            <span className="text-xs text-slate-500">This can take a couple of minutes.</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv" onChange={onFile} className="hidden" />
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" /> Choose file
            </button>
            <span className="text-xs text-slate-500">
              A CSV exported from the Maps scraper works as-is — it already has Website and Emails columns.
            </span>
          </div>
        )}
        {note && <p className="text-sm text-slate-600">{note}</p>}

        {/* Save the raw list the moment it exists — before the audit, so a long scan is
            never the thing standing between finding leads and keeping them. */}
        {businesses.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border-soft">
            <button className="btn mt-3" onClick={downloadCsv}>
              <Download className="w-4 h-4" /> Download CSV ({businesses.length})
            </button>
            <span className="text-xs text-slate-500 mt-3">
              Every business found, with phone, email, address and Maps link
              {withPhone > 0 ? ` — ${withPhone} have a phone number to call` : ""}
              {scanned > 0 ? ", plus the audit scores and report links" : ". Run Step 2 first if you also want audit scores"}.
            </span>
          </div>
        )}
      </div>

      {/* 2 — Audit */}
      {businesses.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="badge">Step 2</span>
            <h2 className="font-semibold">Score their websites</h2>
          </div>
          <p className="text-sm text-slate-500">
            {auditable.length} sites to check. Each takes 15–25 seconds, so {auditable.length} sites is roughly{" "}
            {Math.max(1, Math.round((auditable.length * 20) / 60))} minutes. Sites scored in the last 30 days are re-used.
          </p>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={() => runAudits(false)} disabled={!!busy || !auditable.length}>
              {busy === "audit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              {busy === "audit" ? `Scoring ${progress.done}/${progress.total}…` : "Run audits"}
            </button>
            {scanned > 0 && (
              <button className="btn btn-ghost" onClick={() => runAudits(true)} disabled={!!busy}>
                <RefreshCw className="w-4 h-4" /> Re-score all
              </button>
            )}
            <span className="text-sm text-slate-500">{scanned} scored</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500 border-b">
                <tr>
                  <th className="py-2 pr-3">Business</th>
                  <th className="py-2 pr-3">Website</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">SEO</th>
                  <th className="py-2 pr-3">AI</th>
                  <th className="py-2">Report</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((row, i) => {
                  const a = lookup(row.website);
                  return (
                    <tr key={`${row.website}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-3">{row.name || <span className="text-slate-400">—</span>}</td>
                      <td className="py-2 pr-3 text-slate-500">{row.website || <span className="text-slate-400">no site</span>}</td>
                      <td className="py-2 pr-3 text-slate-500">{row.email || <span className="text-slate-400">no email</span>}</td>
                      <td className={`py-2 pr-3 ${scoreClass(a?.seoScore ?? null, maxSeo)}`}>
                        {a?.status === "ok" ? a.seoScore : a ? "—" : ""}
                      </td>
                      <td className={`py-2 pr-3 ${scoreClass(a?.geoScore ?? null, maxGeo)}`}>
                        {a?.status === "ok" ? a.geoScore : a ? "—" : ""}
                      </td>
                      <td className="py-2">
                        {a?.status === "ok" ? (
                          <a className="text-indigo-600 hover:underline inline-flex items-center gap-1" href={a.reportUrl} target="_blank" rel="noreferrer">
                            open <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : a ? (
                          <span className="text-slate-400" title={a.error}>couldn&apos;t score</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3 — Filter */}
      {scanned > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="badge">Step 3</span>
            <h2 className="font-semibold">Who gets the email</h2>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="block text-slate-500 mb-1">SEO score below</span>
              <input className="input w-24" type="number" min={0} max={100} value={maxSeo} onChange={(e) => setMaxSeo(Number(e.target.value))} />
            </label>
            <label className="text-sm">
              <span className="block text-slate-500 mb-1">AI readiness below</span>
              <input className="input w-24" type="number" min={0} max={100} value={maxGeo} onChange={(e) => setMaxGeo(Number(e.target.value))} />
            </label>
            <p className="text-lg">
              <strong>{buckets.qualified.length}</strong>
              <span className="text-slate-500"> of {businesses.length} qualify</span>
            </p>
          </div>
          <p className="text-sm text-slate-500">
            Excluded: {buckets.noWebsite} no website · {buckets.noEmail} no email ·{" "}
            {buckets.notAudited} not scored yet · {buckets.auditFailed} couldn&apos;t be scored ·{" "}
            {buckets.scoredTooWell} already doing fine.
          </p>
          <p className="text-xs text-slate-400 max-w-3xl">
            Both thresholds must be met. Note that AI readiness is low for almost every small
            business — it counts brand presence on Wikipedia and Wikidata, which local firms
            rarely have — so in practice the SEO number is the one doing the filtering.
          </p>
        </div>
      )}

      {/* 4 — Launch */}
      {buckets.qualified.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="badge">Step 4</span>
            <h2 className="font-semibold">Save the list and write the email</h2>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="input flex-1 min-w-[240px]" placeholder="List name"
              value={listName} onChange={(e) => setListName(e.target.value)}
            />
            <button className="btn btn-primary" onClick={createList} disabled={!!busy || !listName.trim()}>
              {busy === "import" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Save {buckets.qualified.length} to a list
            </button>
          </div>
          {createdList && (
            <p className="text-sm text-emerald-700">
              Saved “{createdList.name}” with {importedCount} contacts. Pick the{" "}
              <strong>Maveriko — Free Site Audit</strong> mail below (edit it any time under Mail Templates).
            </p>
          )}
          <p className="text-xs text-slate-400 max-w-3xl">
            Schedule the campaign rather than sending immediately — scheduled mail respects the
            send window (Mon–Sat, 9am–8pm IST), the daily cap and the per-mailbox warm-up limit.
            &ldquo;Send now&rdquo; bypasses all three.
          </p>
        </div>
      )}

      <CampaignModal
        open={!!createdList}
        onClose={() => setCreatedList(null)}
        onCreated={() => { setCreatedList(null); setNote("Campaign created."); }}
        target={createdList ? { listId: createdList.id } : undefined}
        count={importedCount}
        defaultName={listName}
      />
    </div>
  );
}
