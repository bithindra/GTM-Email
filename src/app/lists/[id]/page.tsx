"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { ArrowLeft, Loader2, Trash2, Save, Plus, Rocket, Upload, FileSpreadsheet } from "lucide-react";
import type { List, Prospect } from "@/lib/types";
import CampaignModal from "@/components/CampaignModal";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function pickCol(keys: string[], ...cands: string[]) {
  for (const k of keys) if (cands.includes(k.toLowerCase().replace(/[^a-z]/g, ""))) return k;
  return null;
}

export default function ListDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [list, setList] = useState<List | null>(null);
  const [members, setMembers] = useState<Prospect[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState("");
  const [adding, setAdding] = useState(false);
  const [newC, setNewC] = useState({ name: "", company: "", email: "" });
  const [note, setNote] = useState("");
  const [showCampaign, setShowCampaign] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [otherLists, setOtherLists] = useState<List[]>([]);
  const [mergeId, setMergeId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/lists/${id}`).then((r) => r.json());
    setList(d.list ?? null);
    setMembers(d.members ?? []);
    setDirty(new Set());
    setSel(new Set());
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/lists").then((r) => r.json()).then((d) => setOtherLists((d.lists ?? []).filter((l: List) => l.id !== id)));
  }, [id]);

  function toggleSel(pid: string) {
    setSel((prev) => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }
  function toggleAll() {
    setSel(sel.size === members.length ? new Set() : new Set(members.map((m) => m.id)));
  }
  async function removeSelected() {
    if (sel.size === 0) return;
    if (!confirm(`Remove ${sel.size} contacts from this list?`)) return;
    await fetch(`/api/lists/${id}/bulk`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeProspectIds: [...sel] }),
    });
    load();
  }
  async function mergeIn() {
    if (!mergeId) return;
    const d = await fetch(`/api/lists/${id}/bulk`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mergeFromListId: mergeId }),
    }).then((r) => r.json());
    if (d.list) setNote(`Merged in — list now has ${d.list.count} contacts.`);
    load();
  }

  function edit(pid: string, field: keyof Prospect, value: string) {
    setMembers((prev) => prev.map((m) => (m.id === pid ? { ...m, [field]: value } : m)));
    setDirty((prev) => new Set(prev).add(pid));
  }

  async function saveRow(p: Prospect) {
    if (!emailRe.test(p.email)) { setNote(`Invalid email for ${p.name || "contact"}.`); return; }
    setSavingId(p.id);
    setNote("");
    try {
      const d = await fetch(`/api/prospects/${p.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, company: p.company, email: p.email }),
      }).then((r) => r.json());
      if (d.error) setNote(d.error);
      else setDirty((prev) => { const n = new Set(prev); n.delete(p.id); return n; });
    } finally { setSavingId(""); }
  }

  async function removeMember(pid: string) {
    if (!confirm("Remove this contact from the list? (They stay in your database.)")) return;
    await fetch(`/api/lists/${id}/members?prospectId=${pid}`, { method: "DELETE" });
    load();
  }

  async function addContact() {
    if (!emailRe.test(newC.email)) { setNote("Enter a valid email to add a contact."); return; }
    setAdding(true);
    setNote("");
    try {
      const d = await fetch(`/api/lists/${id}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newC),
      }).then((r) => r.json());
      if (d.error) setNote(d.error);
      else { setNewC({ name: "", company: "", email: "" }); load(); }
    } finally { setAdding(false); }
  }

  function onAppendFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !list) return;
    setUploading(true);
    setNote("");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        const keys = Object.keys(json[0] ?? {});
        const nameCol = pickCol(keys, "name", "clientname", "contactname", "fullname", "client");
        const companyCol = pickCol(keys, "company", "companyname", "organisation", "organization", "org");
        const emailCol = pickCol(keys, "email", "emailid", "emailaddress", "mail");
        if (!emailCol) { setNote("No email column found in that file."); setUploading(false); return; }
        const rows = json.map((r) => ({
          name: String(nameCol ? r[nameCol] : "").trim(),
          company: String(companyCol ? r[companyCol] : "").trim(),
          email: String(r[emailCol] ?? "").trim().toLowerCase(),
        })).filter((r) => emailRe.test(r.email));
        // upload with the SAME list name -> appends to this list
        const d = await fetch("/api/lists/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: list.name, rows }),
        }).then((r) => r.json());
        setNote(d.list ? `Appended ${rows.length} contacts.` : (d.error || "Append failed"));
        load();
      } catch {
        setNote("Could not parse that file.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsBinaryString(file);
  }

  if (!list) return <div className="p-8 text-muted">Loading…</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/lists" className="text-sm text-muted flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" /> Lists</Link>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{list.name}</h1>
          <p className="text-sm text-muted mt-1">{members.length} contacts · source: {list.source}</p>
        </div>
        <div className="flex gap-2">
          <label className="btn btn-ghost cursor-pointer">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Append file
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv" className="hidden" onChange={onAppendFile} />
          </label>
          <a href={`/api/lists/${id}/export`} download
            className={`btn btn-ghost ${members.length === 0 ? "pointer-events-none opacity-50" : ""}`}
            title="Download every contact in this list as an Excel file">
            <FileSpreadsheet className="w-4 h-4" /> Download Excel
          </a>
          <button className="btn btn-primary" disabled={members.length === 0} onClick={() => setShowCampaign(true)}>
            <Rocket className="w-4 h-4" /> Run campaign
          </button>
        </div>
      </div>

      {note && <div className="mb-4 p-3 rounded-lg bg-indigo-50 text-indigo-800 text-sm">{note}</div>}

      {/* Bulk + merge toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          {sel.size > 0 && (
            <button className="btn btn-ghost" onClick={removeSelected}>
              <Trash2 className="w-4 h-4" /> Remove selected ({sel.size})
            </button>
          )}
        </div>
        {otherLists.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Merge another list in:</span>
            <select className="select w-48" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
              <option value="">— choose list —</option>
              {otherLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
            </select>
            <button className="btn btn-ghost" disabled={!mergeId} onClick={mergeIn}>Merge in</button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-muted text-left">
              <tr>
                <th className="p-3 w-8"><input type="checkbox" checked={members.length > 0 && sel.size === members.length} onChange={toggleAll} /></th>
                <th className="p-3">Client name</th>
                <th className="p-3">Company</th>
                <th className="p-3">Email</th>
                <th className="p-3 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((p) => (
                <tr key={p.id} className="border-t border-border-soft">
                  <td className="p-2 text-center"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} /></td>
                  <td className="p-2"><input className="input" value={p.name} onChange={(e) => edit(p.id, "name", e.target.value)} /></td>
                  <td className="p-2"><input className="input" value={p.company} onChange={(e) => edit(p.id, "company", e.target.value)} /></td>
                  <td className="p-2"><input className="input" value={p.email} onChange={(e) => edit(p.id, "email", e.target.value)} /></td>
                  <td className="p-2">
                    <div className="flex items-center gap-2 justify-end">
                      {dirty.has(p.id) && (
                        <button className="btn btn-primary !py-1.5 !px-3" onClick={() => saveRow(p)} disabled={savingId === p.id}>
                          {savingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                        </button>
                      )}
                      <button className="text-muted hover:text-danger" onClick={() => removeMember(p.id)}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {/* Add row */}
              <tr className="border-t border-border-soft bg-slate-50/50">
                <td className="p-2"></td>
                <td className="p-2"><input className="input" placeholder="Name" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} /></td>
                <td className="p-2"><input className="input" placeholder="Company" value={newC.company} onChange={(e) => setNewC({ ...newC, company: e.target.value })} /></td>
                <td className="p-2"><input className="input" placeholder="email@company.com" value={newC.email} onChange={(e) => setNewC({ ...newC, email: e.target.value })} /></td>
                <td className="p-2">
                  <button className="btn btn-ghost !py-1.5 !px-3 w-full justify-center" onClick={addContact} disabled={adding || !newC.email}>
                    {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CampaignModal
        open={showCampaign}
        onClose={() => setShowCampaign(false)}
        onCreated={(cid) => router.push(`/campaigns/${cid}`)}
        target={{ listId: id }}
        count={members.length}
        defaultName={`${list.name} — ${new Date().toLocaleDateString()}`}
      />
    </div>
  );
}
