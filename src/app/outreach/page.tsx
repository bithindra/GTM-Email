"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  Loader2, MapPin, Upload, ScanSearch, ExternalLink, RefreshCw, Download, Send, Clock, Square,
  CheckCircle2, AlertTriangle, Search, X, Eye, Save,
} from "lucide-react";
import type { AuditRecord, List, Template } from "@/lib/types";
import { GEO_MAX, SEO_MAX } from "@/lib/audit";
import { ALL_BUSINESS_TYPES, BUSINESS_GROUPS, CITY_SUGGESTIONS, mapsQuery, type BusinessType } from "@/lib/business-types";
import { mailboxForCategories } from "@/lib/mailbox-match";
import { errorText, getJson } from "@/lib/client-fetch";

// Everything the Maps scraper gives us. Phone/address/rating/mapsUrl are not used by
// the email flow, but they are the whole point of a saved list you intend to CALL from,
// so they are carried through and exported rather than dropped at the mapping step.
type Business = {
  name: string;
  website: string;
  email: string;
  city: string;
  category: string;
  searchType: string;
  phone: string;
  address: string;
  rating: string;
  reviews: string;
  mapsUrl: string;
};

type Run = { id: string; label: string; status: "queued" | "running" | "done" | "failed" | "stopped"; found: number; withEmail: number; note: string };

/** Websites are audited in batches so the browser sees steady progress instead
 *  of one request that looks hung for ten minutes. */
const AUDIT_BATCH = 8;
/** Maps searches run two at a time: each is a headless browser on the scraper. */
const SCRAPE_CONCURRENCY = 2;
/** The v2 audit mail and its follow-up, matched by name so an edited copy still wins. */
const DEFAULT_MAIL = /Audit Outreach — Scores \+ Growth/;
const DEFAULT_FOLLOWUP = /Audit Outreach — Follow-up/;

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

function hostKey(website: string): string {
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

/** One business per website (or per name + phone when it has no site). */
const dedupeKey = (b: Business) => hostKey(b.website) || `${b.name.toLowerCase()}|${b.phone}`;

const usesAudit = (t: Template) => /\{\{\s*(seo_score|geo_score|report_url|top_fix)\s*\}\}/.test(`${t.subject} ${t.body}`);

export default function OutreachPage() {
  const [tab, setTab] = useState<"maps" | "file">("maps");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [typeSearch, setTypeSearch] = useState("");
  const [customType, setCustomType] = useState("");
  const [perType, setPerType] = useState(20);
  const [autoScore, setAutoScore] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const stopRef = useRef(false);

  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [audits, setAudits] = useState<Record<string, AuditRecord>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Who gets the email: the score thresholds pick a default, ticks override it.
  const [maxSeo, setMaxSeo] = useState(SEO_MAX);
  const [maxGeo, setMaxGeo] = useState(GEO_MAX);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);

  // Sending.
  const [templates, setTemplates] = useState<Template[]>([]);
  const [mailboxes, setMailboxes] = useState<{ id: string; label: string }[]>([]);
  const [setupError, setSetupError] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [followupOn, setFollowupOn] = useState(true);
  const [followupId, setFollowupId] = useState("");
  const [followupDays, setFollowupDays] = useState(4);
  const [fromMailbox, setFromMailbox] = useState("");
  const [listName, setListName] = useState("");
  const [preview, setPreview] = useState<{ email: string; subject: string; body: string; blocked: string | null } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string; campaignId?: string; list?: List } | null>(null);

  useEffect(() => {
    getJson<{ templates: Template[] }>("/api/templates")
      .then((d) => {
        const ts = d.templates ?? [];
        setTemplates(ts);
        setTemplateId((ts.find((t) => DEFAULT_MAIL.test(t.name)) ?? ts.find(usesAudit) ?? ts[0])?.id ?? "");
        setFollowupId(ts.find((t) => DEFAULT_FOLLOWUP.test(t.name))?.id ?? "");
      })
      .catch((e) => setSetupError(errorText(e)));
    getJson<{ mailboxes: { id: string; label: string }[] }>("/api/mailboxes")
      .then((d) => {
        const boxes = d.mailboxes ?? [];
        setMailboxes(boxes);
        // The mail is signed Brand Vibe, so it goes from the Brand Vibe address.
        setFromMailbox(mailboxForCategories(["Brand Vibe"], boxes) ?? boxes[0]?.id ?? "");
      })
      .catch((e) => setSetupError(errorText(e)));
  }, []);

  /* ---------------- 1. Find ---------------- */

  const typeById = useMemo(() => new Map(ALL_BUSINESS_TYPES.map((t) => [t.id, t])), []);
  const pickedTypes: BusinessType[] = [
    ...picked.map((id) => typeById.get(id)).filter((t): t is BusinessType => !!t),
    ...customType.split(",").map((s) => s.trim()).filter(Boolean).map((k) => ({ id: `custom-${k}`, label: k, keyword: k.toLowerCase() })),
  ];
  const filteredGroups = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    if (!q) return BUSINESS_GROUPS;
    return BUSINESS_GROUPS
      .map((g) => ({ ...g, types: g.types.filter((t) => `${t.label} ${t.keyword} ${g.group}`.toLowerCase().includes(q)) }))
      .filter((g) => g.types.length);
  }, [typeSearch]);

  const toggleType = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleGroup = (types: BusinessType[]) => {
    const ids = types.map((t) => t.id);
    setPicked((p) => (ids.every((id) => p.includes(id)) ? p.filter((x) => !ids.includes(x)) : [...new Set([...p, ...ids])]));
  };

  function mapRow(b: Record<string, unknown>, type: BusinessType): Business {
    return {
      name: String(b.name || ""),
      website: String(b.website || ""),
      email: (Array.isArray(b.emails) ? String(b.emails[0] ?? "") : String(b.email || "")).toLowerCase(),
      city: city.trim(),
      category: String(b.category || ""),
      searchType: type.label,
      phone: String(b.phone || ""),
      address: String(b.address || ""),
      rating: String(b.rating || ""),
      reviews: String(b.reviews || ""),
      mapsUrl: String(b.mapsUrl || ""),
    };
  }

  async function runSearch() {
    if (!city.trim()) { setNote("Type a city first."); return; }
    if (!pickedTypes.length) { setNote("Tick at least one business type."); return; }
    stopRef.current = false;
    setBusy("scrape"); setNote(""); setSendResult(null);
    setBusinesses([]); setAudits({}); setSelected(new Set()); setTouched(false); setPreview(null);
    if (!listName) setListName(`${pickedTypes.length === 1 ? pickedTypes[0].label : `${pickedTypes.length} business types`} — ${city.trim()}`);
    const queue = pickedTypes.map((t) => t);
    setRuns(queue.map((t) => ({ id: t.id, label: t.label, status: "queued", found: 0, withEmail: 0, note: "" })));
    const update = (id: string, patch: Partial<Run>) => setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const found: Business[] = [];
    const seen = new Set<string>();

    const worker = async () => {
      while (queue.length) {
        const type = queue.shift()!;
        if (stopRef.current) { update(type.id, { status: "stopped" }); continue; }
        update(type.id, { status: "running" });
        try {
          const d = await getJson<{ businesses?: Record<string, unknown>[]; timedOut?: boolean }>("/api/outreach/scrape", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: mapsQuery(type.keyword, city, area), maxResults: perType }),
          });
          const rows = (d.businesses ?? []).map((b) => mapRow(b, type));
          let added = 0;
          for (const r of rows) {
            const k = dedupeKey(r);
            if (!k || seen.has(k)) continue;
            seen.add(k); found.push(r); added++;
          }
          setBusinesses([...found]);
          update(type.id, {
            status: "done", found: added, withEmail: rows.filter((r) => r.email && r.website).length,
            note: d.timedOut ? "Search ran out of time, so these are partial results." : added < rows.length ? `${rows.length - added} already found under another type` : "",
          });
        } catch (e) {
          update(type.id, { status: "failed", note: errorText(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCRAPE_CONCURRENCY, pickedTypes.length) }, worker));
    setBusy("");
    const withMail = found.filter((r) => r.email && r.website).length;
    setNote(`Found ${found.length} businesses. ${withMail} have a website and an email.`);
    if (autoScore && withMail && !stopRef.current) await runAudits(false, found);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNote(""); setSendResult(null); setRuns([]);
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
          searchType: "",
          phone: String(phoneCol ? r[phoneCol] : "").trim(),
          address: String(addrCol ? r[addrCol] : "").trim(),
          rating: String(ratingCol ? r[ratingCol] : "").trim(),
          reviews: String(reviewsCol ? r[reviewsCol] : "").trim(),
          mapsUrl: String(mapsCol ? r[mapsCol] : "").trim(),
        }));
        setBusinesses(rows);
        setAudits({}); setSelected(new Set()); setTouched(false); setPreview(null);
        const withMail = rows.filter((r) => r.email && r.website).length;
        setNote(`Loaded ${rows.length} rows. ${withMail} have a website and an email.`);
        if (autoScore && withMail) runAudits(false, rows);
      } catch {
        setNote("Couldn't read that file.");
      }
    };
    reader.readAsBinaryString(file);
  }

  /* ---------------- 2. Score ---------------- */

  /** Audits come back keyed by host; a row's raw website string may carry www,
   *  a path or a scheme, so match on the host. */
  const lookup = (website: string): AuditRecord | undefined => audits[hostKey(website)];

  const auditable = useMemo(
    () => [...new Set(businesses.filter((b) => b.website && b.email).map((b) => b.website))],
    [businesses],
  );

  async function runAudits(force = false, rows?: Business[]) {
    const sites = rows ? [...new Set(rows.filter((b) => b.website && b.email).map((b) => b.website))] : auditable;
    // Fresh results (rows) skip the "already scored" filter: this closure may still hold the
    // previous search's scores, and the server's 30-day cache makes repeats cheap anyway.
    const todo = force || rows ? sites : sites.filter((w) => !lookup(w));
    if (!todo.length) { setNote("Nothing left to score."); return; }
    setBusy("audit");
    setProgress({ done: 0, total: todo.length });
    try {
      for (let i = 0; i < todo.length; i += AUDIT_BATCH) {
        if (stopRef.current) break;
        const slice = todo.slice(i, i + AUDIT_BATCH);
        const d = await getJson<{ results?: AuditRecord[] }>("/api/outreach/audit", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ websites: slice }),
        });
        setAudits((prev) => {
          const next = { ...prev };
          for (const a of d.results ?? []) next[a.host.replace(/^www\./, "")] = a;
          return next;
        });
        setProgress({ done: Math.min(i + AUDIT_BATCH, todo.length), total: todo.length });
      }
    } catch (e) {
      setNote(`Scoring stopped: ${errorText(e)} Press “Score websites” to carry on from where it stopped.`);
    } finally { setBusy(""); }
  }

  function stop() {
    stopRef.current = true;
    setNote("Stopping after the searches already running finish…");
  }

  /* ---------------- 3. Choose ---------------- */

  const rowKey = (b: Business) => b.email;
  const isScored = (b: Business) => {
    const a = lookup(b.website);
    return !!a && a.status === "ok" && a.seoScore !== null && a.geoScore !== null;
  };
  const sendable = useMemo(() => businesses.filter((b) => b.email && b.website && isScored(b)), [businesses, audits]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsHelp = (b: Business) => {
    const a = lookup(b.website)!;
    return a.seoScore! < maxSeo && a.geoScore! < maxGeo;
  };

  // Until he ticks something himself, the selection follows the score thresholds.
  useEffect(() => {
    if (!touched) setSelected(new Set(sendable.filter(needsHelp).map(rowKey)));
  }, [sendable, maxSeo, maxGeo, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = sendable.filter((b) => selected.has(rowKey(b)));
  const toggleRow = (b: Business) => {
    setTouched(true);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(rowKey(b))) n.delete(rowKey(b)); else n.add(rowKey(b));
      return n;
    });
  };
  const selectWhere = (pred: (b: Business) => boolean) => { setTouched(true); setSelected(new Set(sendable.filter(pred).map(rowKey))); };

  const counts = useMemo(() => {
    const c = { noWebsite: 0, noEmail: 0, notScored: 0, failed: 0 };
    for (const b of businesses) {
      if (!b.website) c.noWebsite++;
      else if (!b.email) c.noEmail++;
      else if (!lookup(b.website)) c.notScored++;
      else if (!isScored(b)) c.failed++;
    }
    return c;
  }, [businesses, audits]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- 4. Send ---------------- */

  const firstChosen = chosen[0];
  async function showPreview(b: Business | undefined = firstChosen) {
    if (!b || !templateId) return;
    setPreviewError("");
    try {
      const d = await getJson<{ subject: string; body: string; blocked: string | null }>("/api/outreach/preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, business: { name: b.name, website: b.website, city: b.city } }),
      });
      setPreview({ email: b.email, ...d });
    } catch (e) {
      setPreviewError(errorText(e));
    }
  }
  // Keep the preview in step with the chosen mail and the first ticked business.
  useEffect(() => {
    if (firstChosen && templateId) showPreview(firstChosen);
    else setPreview(null);
  }, [templateId, firstChosen?.email, audits]); // eslint-disable-line react-hooks/exhaustive-deps

  const template = templates.find((t) => t.id === templateId);
  const fromLabel = mailboxes.find((m) => m.id === fromMailbox)?.label || fromMailbox || "the default mailbox";

  async function send(when: "now" | "window") {
    if (!chosen.length || !templateId || !listName.trim()) return;
    const what = when === "now" ? "Start sending now" : "Queue for the next send window";
    if (!confirm(`${what}: “${template?.name}” to ${chosen.length} businesses from ${fromLabel}${followupOn && followupId ? `, with a follow-up after ${followupDays} days to anyone who hasn't replied` : ""}?`)) return;
    setBusy("send"); setSendResult(null);
    try {
      // 1. Save them as a list (the server re-checks every audit and the unsubscribe list).
      const imp = await getJson<{ list: List; imported: number; skipped: Record<string, number> }>("/api/outreach/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listName: listName.trim(), businesses: chosen, mode: "picked" }),
      });
      const sk = imp.skipped || {};
      const skippedText = [
        sk.suppressed ? `${sk.suppressed} unsubscribed or bounced before` : "",
        sk.badMx ? `${sk.badMx} with an address that can't receive mail` : "",
        sk.duplicate ? `${sk.duplicate} duplicate addresses` : "",
        sk.notAudited ? `${sk.notAudited} without a usable score` : "",
      ].filter(Boolean).join(", ");

      // 2. The campaign. Always scheduled, so anything the daily or mailbox limit holds
      //    back carries on automatically in the next send window.
      const startAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const camp = await getJson<{ campaign: { id: string } }>("/api/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: listName.trim(), templateId, listId: imp.list.id, fromMailbox: fromMailbox || null,
          followupTemplateId: followupOn && followupId ? followupId : null, followupDays,
          scheduledAt: startAt,
        }),
      });
      const id = camp.campaign.id;
      let text = `Saved ${imp.imported} businesses as “${imp.list.name}”${skippedText ? ` (left out: ${skippedText})` : ""}. `;

      // 3. Send now, if asked. Sunday or a cap just leaves it queued — nothing is lost.
      if (when === "now") {
        const res = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
        const d = await res.json().catch(() => ({}));
        if (res.ok) {
          const held = imp.imported - (d.sent ?? 0) - (d.failed ?? 0);
          text += d.simulated
            ? "Simulated only — no mailbox is configured here."
            : `Sent ${d.sent ?? 0} now${d.failed ? `, ${d.failed} failed` : ""}${held > 0 ? `. The other ${held} go out automatically in the next send window (daily and per-mailbox limits).` : "."}`;
        } else {
          text += `${d.error || "Couldn't start sending."} It's queued and will go out in the next send window.`;
        }
      } else {
        text += "Queued — it goes out automatically in working hours (Mon–Sat, 9am–8pm IST), within the daily limits.";
      }
      setSendResult({ ok: true, text, campaignId: id, list: imp.list });
    } catch (e) {
      setSendResult({ ok: false, text: errorText(e) });
    } finally { setBusy(""); }
  }

  async function saveListOnly() {
    if (!chosen.length || !listName.trim()) return;
    setBusy("import"); setSendResult(null);
    try {
      const imp = await getJson<{ list: List; imported: number }>("/api/outreach/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listName: listName.trim(), businesses: chosen, mode: "picked" }),
      });
      setSendResult({ ok: true, text: `Saved ${imp.imported} businesses as “${imp.list.name}”. Nothing was sent.`, list: imp.list });
    } catch (e) {
      setSendResult({ ok: false, text: errorText(e) });
    } finally { setBusy(""); }
  }

  /* ---------------- Save the full list ---------------- */

  // Export EVERY business found — not just the mail-qualified ones. A business with a
  // phone but no email is useless to the mailer and perfectly good to call, so filtering
  // here would throw away the leads this export exists to keep.
  function downloadCsv() {
    if (!businesses.length) return;
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Name", "Phone", "Email", "Website", "Address", "City", "Business type", "Maps category", "Rating", "Reviews",
      "Maps URL", "SEO score", "AI/GEO score", "SEO band", "GEO band", "Top issue", "Top fix",
      "Report URL", "Audit status", "Selected to email",
    ].join(",");
    const rows = businesses.map((b) => {
      const a = b.website ? lookup(b.website) : undefined;
      return [
        esc(b.name), esc(b.phone), esc(b.email), esc(b.website), esc(b.address), esc(b.city),
        esc(b.searchType), esc(b.category), esc(b.rating), esc(b.reviews), esc(b.mapsUrl),
        esc(a?.seoScore ?? ""), esc(a?.geoScore ?? ""), esc(a?.seoBand ?? ""), esc(a?.geoBand ?? ""),
        esc(a?.topIssue ?? ""), esc(a?.topFix ?? ""), esc(a?.reportUrl ?? ""),
        esc(a ? (a.status === "ok" ? "ok" : a.error || "failed") : "not audited"),
        esc(b.email && selected.has(rowKey(b)) ? "yes" : "no"),
      ].join(",");
    });
    // BOM so Excel opens UTF-8 business names correctly instead of mojibake.
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `${(listName || city || "leads").replace(/[^\w.-]+/g, "_")}_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const scanned = Object.keys(audits).length;
  const withPhone = businesses.filter((b) => b.phone).length;
  const withEmail = businesses.filter((b) => b.email && b.website).length;
  const shown = onlyWithEmail ? businesses.filter((b) => b.email && b.website) : businesses;
  const estMinutes = Math.max(1, Math.ceil(pickedTypes.length / SCRAPE_CONCURRENCY) * (perType > 20 ? 4 : 2));

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Outreach</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl">
          Find local businesses on Google Maps, score each website for SEO and AI readiness with Maveriko, then email
          the ones that need help, straight from here. Every email quotes that business&apos;s own real scores and
          links to its free report.
        </p>
      </div>
      {setupError && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">{setupError}</p>}

      {/* 1 — Find */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="badge">Step 1</span>
          <h2 className="font-semibold">Find businesses</h2>
        </div>
        <div className="flex gap-2">
          <button className={tab === "maps" ? "chip chip-active" : "chip"} onClick={() => setTab("maps")}>
            <MapPin className="w-3.5 h-3.5 inline mr-1" /> Search Google Maps
          </button>
          <button className={tab === "file" ? "chip chip-active" : "chip"} onClick={() => setTab("file")}>
            <Upload className="w-3.5 h-3.5 inline mr-1" /> Upload a CSV
          </button>
        </div>

        {tab === "maps" ? (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-[1fr_1fr_140px] gap-3">
              <label className="block text-sm">
                <span className="text-xs text-muted">City</span>
                <input className="input mt-1" list="city-suggestions" placeholder="e.g. Pune" value={city} onChange={(e) => setCity(e.target.value)} />
                <datalist id="city-suggestions">{CITY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted">Area <span className="text-slate-400">(optional, narrows the search)</span></span>
                <input className="input mt-1" placeholder="e.g. Koregaon Park" value={area} onChange={(e) => setArea(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted">Results per type</span>
                <select className="select mt-1" value={perType} onChange={(e) => setPerType(Number(e.target.value))}>
                  {[10, 20, 30, 40, 60].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs text-muted">Business types — tick as many as you like</span>
                <div className="relative ml-auto">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input !py-1.5 pl-8 w-56" placeholder="Search types…" value={typeSearch} onChange={(e) => setTypeSearch(e.target.value)} />
                </div>
                {picked.length > 0 && <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => setPicked([])}>Clear ({picked.length})</button>}
              </div>
              <div className="border border-border-soft rounded-lg max-h-80 overflow-y-auto p-3 space-y-3">
                {filteredGroups.map((g) => {
                  const all = g.types.every((t) => picked.includes(t.id));
                  return (
                    <div key={g.group}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-slate-700">{g.group}</span>
                        <button className="text-[11px] text-indigo-600 hover:underline" onClick={() => toggleGroup(g.types)}>
                          {all ? "untick all" : "tick all"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.types.map((t) => (
                          <button key={t.id} onClick={() => toggleType(t.id)} aria-pressed={picked.includes(t.id)}
                            className={picked.includes(t.id) ? "chip chip-active !text-xs" : "chip !text-xs"}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {!filteredGroups.length && <p className="text-xs text-muted">No type matches “{typeSearch}”. Add it below as your own.</p>}
              </div>
              <label className="block text-sm mt-2">
                <span className="text-xs text-muted">Anything else? <span className="text-slate-400">(your own types, separated by commas)</span></span>
                <input className="input mt-1" placeholder="e.g. yoga teacher training, robotics classes" value={customType} onChange={(e) => setCustomType(e.target.value)} />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {busy === "scrape" ? (
                <button className="btn btn-ghost" onClick={stop}><Square className="w-4 h-4" /> Stop</button>
              ) : (
                <button className="btn btn-primary" onClick={runSearch} disabled={!!busy || !city.trim() || !pickedTypes.length}>
                  <MapPin className="w-4 h-4" /> Search {pickedTypes.length ? `${pickedTypes.length} type${pickedTypes.length > 1 ? "s" : ""}` : ""}{city.trim() ? ` in ${city.trim()}` : ""}
                </button>
              )}
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={autoScore} onChange={(e) => setAutoScore(e.target.checked)} />
                Score the websites automatically when done
              </label>
              {pickedTypes.length > 0 && busy !== "scrape" && (
                <span className="text-xs text-muted">About {estMinutes} min. Each type is a separate Maps search, run two at a time.</span>
              )}
            </div>

            {runs.length > 0 && (
              <ul className="grid sm:grid-cols-2 gap-1.5">
                {runs.map((r) => (
                  <li key={r.id} className="text-xs flex items-start gap-1.5 border border-border-soft rounded-md px-2 py-1.5">
                    {r.status === "running" ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500 mt-0.5" />
                      : r.status === "done" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5" />
                      : r.status === "failed" ? <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5" />
                      : <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5" />}
                    <span>
                      <b>{r.label}</b>{" "}
                      {r.status === "done" ? `— ${r.found} found, ${r.withEmail} with email` : r.status === "queued" ? "— waiting" : r.status === "stopped" ? "— skipped" : r.status === "running" ? "— searching…" : ""}
                      {r.note && <span className="block text-muted">{r.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border-soft">
            <button className="btn" onClick={downloadCsv}>
              <Download className="w-4 h-4" /> Download all {businesses.length} as CSV
            </button>
            <span className="text-xs text-slate-500">
              Every business found, with phone, email, address and Maps link
              {withPhone > 0 ? ` (${withPhone} have a phone number to call)` : ""}
              {scanned > 0 ? ", plus scores and report links" : ""}.
            </span>
          </div>
        )}
      </div>

      {/* 2 + 3 — Score and choose */}
      {businesses.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="badge">Step 2</span>
            <h2 className="font-semibold">Score the websites and choose who gets the email</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={() => runAudits(false)} disabled={!!busy || !auditable.length || auditable.every((w) => lookup(w))}>
              {busy === "audit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              {busy === "audit" ? `Scoring ${progress.done} of ${progress.total}…` : auditable.every((w) => lookup(w)) ? "All scored" : `Score ${auditable.filter((w) => !lookup(w)).length} websites`}
            </button>
            {busy === "audit" && <button className="btn btn-ghost" onClick={stop}><Square className="w-4 h-4" /> Stop</button>}
            {scanned > 0 && busy !== "audit" && (
              <button className="btn btn-ghost" onClick={() => runAudits(true)} disabled={!!busy}>
                <RefreshCw className="w-4 h-4" /> Re-score all
              </button>
            )}
            <span className="text-xs text-muted">
              Only businesses with a website and an email are scored ({withEmail} of {businesses.length}), about 20 seconds each.
              Sites scored in the last 30 days are reused.
            </span>
          </div>

          {sendable.length > 0 && (
            <div className="flex flex-wrap items-end gap-4 bg-slate-50 border border-border-soft rounded-lg p-3">
              <div className="text-sm">
                <div className="text-xs text-muted mb-1">Quick select: needs help when</div>
                <div className="flex items-center gap-2">
                  <span>SEO below</span>
                  <input className="input w-20 !py-1" type="number" min={0} max={101} value={maxSeo} onChange={(e) => { setTouched(false); setMaxSeo(Number(e.target.value)); }} />
                  <span>and AI readiness below</span>
                  <input className="input w-20 !py-1" type="number" min={0} max={101} value={maxGeo} onChange={(e) => { setTouched(false); setMaxGeo(Number(e.target.value)); }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => { setTouched(false); }}>Needs help</button>
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => selectWhere(() => true)}>All {sendable.length} scored</button>
                <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => selectWhere(() => false)}>None</button>
              </div>
              <p className="text-lg ml-auto"><strong>{chosen.length}</strong><span className="text-muted text-sm"> of {sendable.length} scored businesses ticked</span></p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 text-xs text-muted">
            <span>
              Can&apos;t be emailed: {counts.noWebsite} no website · {counts.noEmail} no email · {counts.failed} couldn&apos;t be scored
              {counts.notScored ? ` · ${counts.notScored} not scored yet` : ""}
            </span>
            <label className="flex items-center gap-1.5 shrink-0">
              <input type="checkbox" checked={onlyWithEmail} onChange={(e) => setOnlyWithEmail(e.target.checked)} /> Only show ones with an email
            </label>
          </div>

          <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-border-soft rounded-lg">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500 border-b bg-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 w-8"></th>
                  <th className="py-2 pr-3">Business</th>
                  <th className="py-2 pr-3">Website</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">SEO</th>
                  <th className="py-2 pr-3">AI</th>
                  <th className="py-2 pr-3">Report</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => {
                  const a = lookup(row.website);
                  const canSend = !!row.email && !!row.website && isScored(row);
                  return (
                    <tr key={`${dedupeKey(row)}-${i}`} className={`border-b last:border-0 ${canSend && selected.has(rowKey(row)) ? "bg-indigo-50/50" : ""}`}>
                      <td className="py-2 px-3">
                        <input type="checkbox" disabled={!canSend} checked={canSend && selected.has(rowKey(row))} onChange={() => toggleRow(row)}
                          title={canSend ? "Email this business" : "Needs an email and a score first"} />
                      </td>
                      <td className="py-2 pr-3">
                        {row.name || <span className="text-slate-400">—</span>}
                        {row.searchType && <span className="block text-[11px] text-muted">{row.searchType}</span>}
                      </td>
                      <td className="py-2 pr-3 text-slate-500 max-w-[180px] truncate">{row.website ? hostKey(row.website) : <span className="text-slate-400">no site</span>}</td>
                      <td className="py-2 pr-3 text-slate-500 max-w-[200px] truncate">{row.email || <span className="text-slate-400">no email</span>}</td>
                      <td className={`py-2 pr-3 ${scoreClass(a?.seoScore ?? null, maxSeo)}`}>{a?.status === "ok" ? a.seoScore : a ? "—" : ""}</td>
                      <td className={`py-2 pr-3 ${scoreClass(a?.geoScore ?? null, maxGeo)}`}>{a?.status === "ok" ? a.geoScore : a ? "—" : ""}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {a?.status === "ok" ? (
                          <>
                            <a className="text-indigo-600 hover:underline inline-flex items-center gap-1" href={a.reportUrl} target="_blank" rel="noreferrer">
                              open <ExternalLink className="w-3 h-3" />
                            </a>
                            {canSend && (
                              <button className="ml-2 text-muted hover:text-foreground inline-flex items-center gap-1" onClick={() => showPreview(row)} title="Preview the email this business would get">
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        ) : a ? (
                          <span className="text-slate-400" title={a.error}>couldn&apos;t score</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr><td colSpan={7} className="py-6 text-center text-sm text-muted">None of these businesses list an email on their website. Untick “Only show ones with an email” to see them all.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3 — Send */}
      {sendable.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="badge">Step 3</span>
            <h2 className="font-semibold">Send the email</h2>
          </div>
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-5">
            <div className="space-y-3">
              <label className="block text-sm"><span className="text-xs text-muted">Mail</span>
                <select className="select mt-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {templates.filter(usesAudit).length > 0 && (
                    <optgroup label="Quotes their scores (recommended)">
                      {templates.filter(usesAudit).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Other mails">
                    {templates.filter((t) => !usesAudit(t)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                </select>
              </label>
              <div className="text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={followupOn} onChange={(e) => setFollowupOn(e.target.checked)} />
                  Follow up with anyone who hasn&apos;t replied after
                  <input className="input w-16 !py-1" type="number" min={2} max={21} value={followupDays} onChange={(e) => setFollowupDays(Math.max(2, Number(e.target.value) || 4))} disabled={!followupOn} />
                  days
                </label>
                {followupOn && (
                  <select className="select mt-2" value={followupId} onChange={(e) => setFollowupId(e.target.value)}>
                    <option value="">Pick a follow-up mail…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>
              <label className="block text-sm"><span className="text-xs text-muted">Send from</span>
                <select className="select mt-1" value={fromMailbox} onChange={(e) => setFromMailbox(e.target.value)}>
                  {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label className="block text-sm"><span className="text-xs text-muted">Save these businesses as the list</span>
                <input className="input mt-1" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Dental clinics — Pune" />
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn btn-primary" onClick={() => send("now")} disabled={!!busy || !chosen.length || !templateId || !listName.trim() || !!preview?.blocked}>
                  {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {chosen.length} now
                </button>
                <button className="btn btn-ghost" onClick={() => send("window")} disabled={!!busy || !chosen.length || !templateId || !listName.trim() || !!preview?.blocked}>
                  <Clock className="w-4 h-4" /> Send in working hours
                </button>
                <button className="btn btn-ghost" onClick={saveListOnly} disabled={!!busy || !chosen.length || !listName.trim()} title="Save the ticked businesses as a list without sending">
                  {busy === "import" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Just save the list
                </button>
              </div>
              <p className="text-[11px] text-muted">
                &ldquo;Now&rdquo; starts straight away, but never on a Sunday. Either way, the daily limit and each
                mailbox&apos;s warm-up limit apply, and whatever they hold back goes out by itself in the next send window
                (Mon–Sat, 9am–8pm IST). Anyone who unsubscribed or bounced before is left out automatically.
              </p>
              {sendResult && (
                <div className={`text-sm rounded-md p-3 border ${sendResult.ok ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-rose-800 bg-rose-50 border-rose-200"}`}>
                  {sendResult.text}
                  {sendResult.campaignId && <> <Link className="underline" href={`/campaigns/${sendResult.campaignId}`}>Open the campaign</Link></>}
                  {!sendResult.campaignId && sendResult.list && <> <Link className="underline" href={`/lists/${sendResult.list.id}`}>Open the list</Link></>}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-muted mb-1 flex items-center gap-1">
                <Eye className="w-3.5 h-3.5" /> {preview ? <>What <b className="text-foreground">{preview.email}</b> will get</> : "Preview"}
              </div>
              {previewError && <p className="text-xs text-rose-700">{previewError}</p>}
              {preview ? (
                <div className="border border-border-soft rounded-lg p-4 bg-white">
                  {preview.blocked && (
                    <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md p-2 mb-3 flex gap-1.5">
                      <X className="w-3.5 h-3.5 mt-0.5 shrink-0" /> This mail can&apos;t go to this business: {preview.blocked}. Pick another mail.
                    </p>
                  )}
                  <div className="text-sm font-semibold mb-3">{preview.subject}</div>
                  <pre className="text-[13px] leading-relaxed whitespace-pre-wrap font-sans text-slate-800">{preview.body}</pre>
                </div>
              ) : (
                <p className="text-sm text-muted border border-dashed border-border-soft rounded-lg p-6 text-center">Tick a business to see its email.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
