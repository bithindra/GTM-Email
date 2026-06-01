"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Loader2, Linkedin, Mail, CheckCircle2, Rocket, Save, Clock, CheckCircle, XCircle, CalendarClock } from "lucide-react";
import type { Prospect, List, SourcingRequest } from "@/lib/types";
import { INDUSTRY_OPTIONS, SENIORITY_OPTIONS, REVENUE_BANDS } from "@/lib/filters";
import CampaignModal from "@/components/CampaignModal";

const COUNTRIES = ["United States", "United Kingdom", "Germany", "India", "Singapore", "Canada", "Australia", "United Arab Emirates", "Netherlands", "Brazil", "France", "Japan", "Spain", "Italy", "Ireland", "Sweden", "Switzerland", "Israel", "Saudi Arabia", "South Africa", "Nigeria", "Kenya", "Mexico", "Indonesia"];
const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000"];
const TITLES = ["Founder", "Co-Founder", "Founder & CEO", "CEO", "Owner", "Managing Director", "President"];

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <span className={`chip ${active ? "chip-active" : ""}`} onClick={onClick}>
      {active && <CheckCircle2 className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

function toggle(arr: string[], v: string) {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export default function ProspectsPage() {
  const router = useRouter();
  const [countries, setCountries] = useState<string[]>(["United States"]);
  const [sizes, setSizes] = useState<string[]>(["11-50"]);
  const [titles, setTitles] = useState<string[]>(["Founder", "CEO"]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [revenueRanges, setRevenueRanges] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");
  const [limit, setLimit] = useState(25);

  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>("");
  const [results, setResults] = useState<Prospect[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCampaign, setShowCampaign] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [listNote, setListNote] = useState("");
  const [showSaveList, setShowSaveList] = useState(false);
  const [saveMode, setSaveMode] = useState<"new" | "existing">("new");
  const [newListName, setNewListName] = useState("");
  const [existingListId, setExistingListId] = useState("");
  const [existingLists, setExistingLists] = useState<List[]>([]);
  const [requests, setRequests] = useState<SourcingRequest[]>([]);
  const [queuing, setQueuing] = useState(false);

  async function loadRequests() {
    const d = await fetch("/api/sourcing").then((r) => r.json());
    setRequests(d.requests ?? []);
  }
  useEffect(() => { loadRequests(); }, []);

  async function queueAutoPull() {
    if (countries.length === 0 || titles.length === 0) { setListNote("Pick at least one geography and one role."); return; }
    setQueuing(true);
    setListNote("");
    try {
      await fetch("/api/sourcing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countries, sizes, titles, industries, seniorities, revenueRanges, keywords, limit }),
      });
      setListNote("Queued ✓ — auto-pulling via Apollo now (reveals emails, ~1 credit each)…");
      // Kick the dispatcher so it fulfills right away (also runs on app open + daily cron).
      await fetch("/api/dispatch/tick").catch(() => {});
      await loadRequests();
      setListNote("Done — check the queue below; fulfilled pulls link to their list.");
    } finally { setQueuing(false); }
  }

  async function runSearch() {
    if (countries.length === 0 || titles.length === 0) { setListNote("Pick at least one geography and one role."); return; }
    setLoading(true);
    setSelected(new Set());
    setListNote("");
    try {
      const d = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countries, sizes, titles, industries, seniorities, revenueRanges, keywords, limit }),
      }).then((r) => r.json());
      setResults(d.prospects ?? []);
      setSource(d.source);
      if (d.error) setListNote(`Apollo: ${d.error}`);
      else if (d.note) setListNote(`${d.prospects?.length || 0} results. Note: ${d.note}`);
      else if (!d.prospects?.length) setListNote("No matches — widen your filters.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSaved() {
    setLoading(true);
    setSelected(new Set());
    setListNote("");
    try {
      const d = await fetch("/api/prospects").then((r) => r.json());
      setResults(d.prospects ?? []);
      setSource("saved");
    } finally {
      setLoading(false);
    }
  }

  function toggleSel(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAll() {
    setSelected(selected.size === results.length ? new Set() : new Set(results.map((r) => r.id)));
  }

  async function openSaveList() {
    setListNote("");
    setNewListName(`${source === "saved" ? "Saved set" : "Prospecting"} — ${new Date().toLocaleDateString()}`);
    const d = await fetch("/api/lists").then((r) => r.json());
    setExistingLists(d.lists ?? []);
    setSaveMode("new");
    setExistingListId(d.lists?.[0]?.id ?? "");
    setShowSaveList(true);
  }

  async function confirmSaveList() {
    setSavingList(true);
    setListNote("");
    try {
      let d;
      if (source === "apollo") {
        // Live Apollo results: reveal emails (1 credit each) + save selected.
        const chosen = results.filter((r) => selected.has(r.id));
        const payload: Record<string, unknown> = { prospects: chosen };
        if (saveMode === "new") { if (!newListName.trim()) { setSavingList(false); return; } payload.listName = newListName.trim(); }
        else { if (!existingListId) { setSavingList(false); return; } payload.listId = existingListId; }
        d = await fetch("/api/apollo/save", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        }).then((r) => r.json());
        if (d.list) setListNote(`Revealed ${d.creditsUsed} emails (Apollo credits) · saved ${d.saved} to "${d.list.name}" (${d.list.count} total). Open it in Lists & Upload.`);
        else setListNote(d.error || "Could not save");
      } else if (saveMode === "new") {
        if (!newListName.trim()) { setSavingList(false); return; }
        d = await fetch("/api/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newListName.trim(), prospectIds: [...selected], source: source || "manual" }),
        }).then((r) => r.json());
        if (d.list) setListNote(`Saved to "${d.list.name}" — now ${d.list.count} contacts. Find it under Lists & Upload.`);
        else setListNote(d.error || "Could not save list");
      } else {
        if (!existingListId) { setSavingList(false); return; }
        d = await fetch(`/api/lists/${existingListId}/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addProspectIds: [...selected] }),
        }).then((r) => r.json());
        if (d.list) setListNote(`Saved to "${d.list.name}" — now ${d.list.count} contacts. Find it under Lists & Upload.`);
        else setListNote(d.error || "Could not save list");
      }
      setShowSaveList(false);
    } finally {
      setSavingList(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold">Find B2B Founders</h1>
      <p className="text-sm text-muted mt-1 mb-6">Search Apollo&apos;s live B2B database by geography, size and role. Pick the ones you want, then <strong>Save as list</strong> to reveal verified emails (1 Apollo credit each).</p>

      <div className="card p-5 mb-6 space-y-4">
        <div>
          <label className="text-sm font-semibold block mb-2">Geography</label>
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map((c) => <Chip key={c} label={c} active={countries.includes(c)} onClick={() => setCountries(toggle(countries, c))} />)}
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-2">Company size (employees)</label>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => <Chip key={s} label={s} active={sizes.includes(s)} onClick={() => setSizes(toggle(sizes, s))} />)}
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-2">Role / title</label>
          <div className="flex flex-wrap gap-2">
            {TITLES.map((t) => <Chip key={t} label={t} active={titles.includes(t)} onClick={() => setTitles(toggle(titles, t))} />)}
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-2">Seniority <span className="text-muted font-normal">(optional)</span></label>
          <div className="flex flex-wrap gap-2">
            {SENIORITY_OPTIONS.map((s) => <Chip key={s.value} label={s.label} active={seniorities.includes(s.value)} onClick={() => setSeniorities(toggle(seniorities, s.value))} />)}
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-2">Company revenue <span className="text-muted font-normal">(optional)</span></label>
          <div className="flex flex-wrap gap-2">
            {REVENUE_BANDS.map((b) => <Chip key={b.label} label={b.label} active={revenueRanges.includes(b.label)} onClick={() => setRevenueRanges(toggle(revenueRanges, b.label))} />)}
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-2">Industry <span className="text-muted font-normal">(optional)</span></label>
          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-0.5">
            {INDUSTRY_OPTIONS.map((i) => <Chip key={i} label={i} active={industries.includes(i)} onClick={() => setIndustries(toggle(industries, i))} />)}
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div className="sm:col-span-2">
            <label className="text-sm font-semibold block mb-2">Keywords <span className="text-muted font-normal">(optional)</span></label>
            <input className="input" placeholder="e.g. AI, sustainability, B2B" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-2">Max results</label>
            <select className="select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn btn-primary" onClick={runSearch} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "Searching…" : "Search (live · Apollo)"}
          </button>
          <button className="btn btn-ghost" onClick={queueAutoPull} disabled={queuing}>
            {queuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />} Queue auto-pull
          </button>
          <button className="btn btn-ghost" onClick={loadSaved} disabled={loading}>Show saved prospects</button>
        </div>
        <p className="text-xs text-muted">Search = instant results you pick from. Auto-pull = hands-off; the app sources via Apollo + reveals emails into a list on its own. Emails cost ~1 Apollo credit each.</p>
      </div>

      {listNote && <div className="mb-4 p-3 rounded-lg bg-indigo-50 text-indigo-800 text-sm">{listNote}</div>}

      {/* Auto-pull queue status */}
      {requests.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="p-4 border-b border-border-soft font-semibold text-sm">Auto-pull queue (Apollo)</div>
          <div className="divide-y divide-border-soft">
            {requests.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center justify-between p-4 gap-3 flex-wrap">
                <div className="text-sm">
                  <div className="font-medium">{(r.filters.titles || []).slice(0, 2).join(", ")} · {(r.filters.countries || []).join(", ")}{r.filters.sizes?.length ? ` · ${r.filters.sizes.join("/")} emp` : ""}</div>
                  <div className="text-xs text-muted">{(r.filters.industries || []).join(", ") || "any industry"} · up to {r.filters.limit} · {new Date(r.createdAt).toLocaleString()}{r.note ? ` · ${r.note}` : ""}</div>
                </div>
                <div className="flex items-center gap-3">
                  {r.status === "pending" && <span className="badge inline-flex items-center gap-1" style={{ background: "#fef3c7", color: "#b45309" }}><Clock className="w-3.5 h-3.5" /> pending</span>}
                  {r.status === "fulfilled" && <span className="badge inline-flex items-center gap-1" style={{ background: "#dcfce7", color: "#15803d" }}><CheckCircle className="w-3.5 h-3.5" /> {r.importedCount} leads</span>}
                  {r.status === "rejected" && <span className="badge inline-flex items-center gap-1" style={{ background: "#fee2e2", color: "#b91c1c" }}><XCircle className="w-3.5 h-3.5" /> none</span>}
                  {r.resultListId && <Link href={`/lists/${r.resultListId}`} className="btn btn-ghost !py-1.5 !px-3">Open list</Link>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border-soft flex-wrap gap-2">
            <div className="text-sm">
              <span className="font-semibold">{results.length} founders</span>
              {source === "mock" && <span className="ml-2 badge" style={{ background: "#fef3c7", color: "#b45309" }}>sample data — APOLLO_API_KEY not set</span>}
              {source === "apollo" && <span className="ml-2 badge" style={{ background: "#dcfce7", color: "#15803d" }}>live · Apollo · emails reveal on save</span>}
              {source === "saved" && <span className="ml-2 badge" style={{ background: "#e0e7ff", color: "#4338ca" }}>saved · your database</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">{selected.size} selected</span>
              <button className="btn btn-ghost" onClick={selectAll}>{selected.size === results.length ? "Clear" : "Select all"}</button>
              <button className="btn btn-primary" disabled={selected.size === 0} onClick={openSaveList}>
                <Save className="w-4 h-4" /> {source === "apollo" ? "Save + reveal emails" : "Save as list"}
              </button>
              {source !== "apollo" && (
                <button className="btn btn-ghost" disabled={selected.size === 0} onClick={() => setShowCampaign(true)}>
                  <Rocket className="w-4 h-4" /> Create campaign
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-muted">
                <tr className="text-left">
                  <th className="p-3 w-8"></th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Company</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Links</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p) => (
                  <tr key={p.id} className="border-t border-border-soft hover:bg-slate-50">
                    <td className="p-3"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} /></td>
                    <td className="p-3"><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.title}</div></td>
                    <td className="p-3"><div>{p.company}</div><div className="text-xs text-muted">{p.industry}</div></td>
                    <td className="p-3">{p.companySize}</td>
                    <td className="p-3">{p.city ? `${p.city}, ` : ""}{p.country}</td>
                    <td className="p-3">
                      <span className="block">{p.email || "—"}</span>
                      {p.emailStatus === "verified" && <span className="text-[11px] text-green-600">✓ verified</span>}
                      {p.emailStatus === "guessed" && <span className="text-[11px] text-amber-600">~ guessed</span>}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        {p.linkedin && <a href={p.linkedin} target="_blank" className="text-[#0a66c2]"><Linkedin className="w-4 h-4" /></a>}
                        {p.email && <a href={`mailto:${p.email}`} className="text-muted"><Mail className="w-4 h-4" /></a>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CampaignModal
        open={showCampaign}
        onClose={() => setShowCampaign(false)}
        onCreated={(id) => router.push(`/campaigns/${id}`)}
        target={{ prospectIds: [...selected] }}
        count={selected.size}
      />

      {showSaveList && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShowSaveList(false)}>
          <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">Save {selected.size} contacts</h3>
            <p className="text-sm text-muted mb-4">Save this set as a new list, or merge it into an existing one.</p>
            <div className="flex gap-2 mb-4">
              <button className={`chip ${saveMode === "new" ? "chip-active" : ""}`} onClick={() => setSaveMode("new")}>New list</button>
              <button className={`chip ${saveMode === "existing" ? "chip-active" : ""}`} onClick={() => setSaveMode("existing")} disabled={existingLists.length === 0}>Merge into existing</button>
            </div>
            {saveMode === "new" ? (
              <input className="input mb-5" placeholder="List name" value={newListName} onChange={(e) => setNewListName(e.target.value)} />
            ) : (
              <select className="select mb-5" value={existingListId} onChange={(e) => setExistingListId(e.target.value)}>
                {existingLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowSaveList(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={savingList} onClick={confirmSaveList}>
                {savingList ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
