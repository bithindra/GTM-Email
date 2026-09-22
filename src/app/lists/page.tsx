"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Upload, Loader2, Trash2, Rocket, ListChecks, FileSpreadsheet } from "lucide-react";
import type { List } from "@/lib/types";
import CampaignModal from "@/components/CampaignModal";

type ParsedRow = { name: string; company: string; email: string };

function pickCol(keys: string[], ...candidates: string[]) {
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, "");
    if (candidates.includes(norm)) return k;
  }
  return null;
}

export default function ListsPage() {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [listName, setListName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");
  const [campaignFor, setCampaignFor] = useState<List | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadLists() {
    const d = await fetch("/api/lists").then((r) => r.json());
    setLists(d.lists ?? []);
  }
  useEffect(() => { loadLists(); }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setNote("");
    if (!listName) setListName(file.name.replace(/\.(csv|xlsx?|tsv)$/i, ""));
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (!json.length) { setNote("That file has no rows."); setParsed([]); return; }
        const keys = Object.keys(json[0]);
        const nameCol = pickCol(keys, "name", "clientname", "contactname", "fullname", "client");
        const companyCol = pickCol(keys, "company", "companyname", "organisation", "organization", "org");
        const emailCol = pickCol(keys, "email", "emailid", "emailaddress", "mail");
        if (!emailCol) { setNote("Couldn't find an email column. Expected headers like: Client name, Company name, Email."); setParsed([]); return; }
        const rows: ParsedRow[] = json.map((r) => ({
          name: String(nameCol ? r[nameCol] : "").trim(),
          company: String(companyCol ? r[companyCol] : "").trim(),
          email: String(r[emailCol] ?? "").trim().toLowerCase(),
        })).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
        setParsed(rows);
        setNote(`${rows.length} valid rows ready (${json.length - rows.length} skipped — missing/invalid email).`);
      } catch {
        setNote("Could not parse that file. Use .csv or .xlsx with Client name, Company name, Email columns.");
        setParsed([]);
      }
    };
    reader.readAsBinaryString(file);
  }

  async function upload() {
    if (!listName || !parsed.length) return;
    setUploading(true);
    setNote("");
    try {
      const d = await fetch("/api/lists/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: listName, rows: parsed }),
      }).then((r) => r.json());
      if (d.list) {
        const bits = [`${d.imported} imported`];
        if (d.duplicates) bits.push(`${d.duplicates} duplicates merged`);
        if (d.invalidSyntax) bits.push(`${d.invalidSyntax} invalid format`);
        if (d.noMx) bits.push(`${d.noMx} flagged (no mail server) — kept but marked unverified`);
        setNote(`Saved "${d.list.name}" (${d.list.count} total). ${bits.join(" · ")}.`);
        setParsed([]); setFileName(""); setListName("");
        if (fileRef.current) fileRef.current.value = "";
        loadLists();
      } else {
        const extra = d.summary ? ` (${d.summary.invalid_syntax} invalid format, ${d.summary.no_mx} no mail server)` : "";
        setNote((d.error || "Upload failed") + extra);
      }
    } finally { setUploading(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this list? (Contacts stay in your database; only the list is removed.)")) return;
    await fetch(`/api/lists?id=${id}`, { method: "DELETE" });
    loadLists();
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">Lists &amp; Upload</h1>
      <p className="text-sm text-muted mt-1 mb-6">Upload a client sheet or save any culled set as a named list — then run a campaign against it anytime.</p>

      {/* Upload */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <FileSpreadsheet className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Upload clients (CSV / Excel)</h2>
        </div>
        <p className="text-xs text-muted mb-4">Columns expected: <strong>Client name</strong>, <strong>Company name</strong>, <strong>Email</strong> (header names are matched flexibly; email is required).</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-semibold block mb-1">File</label>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv" onChange={onFile}
              className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-primary file:font-medium" />
            {fileName && <p className="text-xs text-muted mt-1">{fileName}</p>}
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1">List name</label>
            <input className="input" placeholder="e.g. EdTech Clients — India" value={listName} onChange={(e) => setListName(e.target.value)} />
          </div>
        </div>
        {parsed.length > 0 && (
          <div className="mt-4 border border-border-soft rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 text-xs text-muted">Preview — first 5 of {parsed.length}</div>
            <table className="w-full text-sm">
              <tbody>
                {parsed.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-border-soft">
                    <td className="p-2">{r.name || <span className="text-muted">—</span>}</td>
                    <td className="p-2">{r.company || <span className="text-muted">—</span>}</td>
                    <td className="p-2">{r.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3 mt-4">
          <button className="btn btn-primary" onClick={upload} disabled={uploading || !parsed.length || !listName}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import &amp; save list
          </button>
          {note && <span className="text-sm text-muted">{note}</span>}
        </div>
      </div>

      {/* Saved lists */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border-soft flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Saved lists</h2>
        </div>
        {lists.length === 0 ? (
          <p className="p-6 text-sm text-muted">No saved lists yet. Upload a sheet above, or save a selection from Find Founders.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-muted text-left">
              <tr>
                <th className="p-3">List</th>
                <th className="p-3">Contacts</th>
                <th className="p-3">Source</th>
                <th className="p-3">Created</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className="border-t border-border-soft hover:bg-slate-50">
                  <td className="p-3 font-medium">
                    <Link href={`/lists/${l.id}`} className="text-primary hover:underline">{l.name}</Link>
                  </td>
                  <td className="p-3">{l.count}</td>
                  <td className="p-3"><span className="badge" style={{ background: "#eef2ff", color: "#4338ca" }}>{l.source}</span></td>
                  <td className="p-3 text-muted">{new Date(l.createdAt).toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-3 justify-end">
                      <Link href={`/lists/${l.id}`} className="btn btn-ghost">View / edit</Link>
                      <a href={`/api/lists/${l.id}/export`} download className="btn btn-ghost" title="Download every contact in this list as an Excel file">
                        <FileSpreadsheet className="w-4 h-4" /> Excel
                      </a>
                      <button className="btn btn-primary" onClick={() => setCampaignFor(l)}><Rocket className="w-4 h-4" /> Campaign</button>
                      <button className="text-muted hover:text-danger" onClick={() => del(l.id)}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CampaignModal
        open={!!campaignFor}
        onClose={() => setCampaignFor(null)}
        onCreated={(id) => router.push(`/campaigns/${id}`)}
        target={campaignFor ? { listId: campaignFor.id } : { prospectIds: [] }}
        count={campaignFor?.count ?? 0}
        defaultName={campaignFor ? `${campaignFor.name} — ${new Date().toLocaleDateString()}` : undefined}
      />
    </div>
  );
}
