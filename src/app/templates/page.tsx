"use client";

import { useEffect, useState } from "react";
import { FileText, Plus, Save, Trash2, Loader2 } from "lucide-react";
import type { Template } from "@/lib/types";

const MERGE_FIELDS = ["first_name", "name", "company", "title", "city", "country"];
const SAMPLE: Record<string, string> = {
  first_name: "Sofia", name: "Sofia Garcia", company: "Nova Labs",
  title: "Founder & CEO", city: "San Francisco", country: "United States",
};

function render(text: string) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`);
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [active, setActive] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);

  async function load(selectId?: string) {
    const d = await fetch("/api/templates").then((r) => r.json());
    setTemplates(d.templates ?? []);
    const sel = selectId ? d.templates.find((t: Template) => t.id === selectId) : d.templates?.[0];
    setActive(sel ?? null);
  }
  useEffect(() => { load(); }, []);

  function newTemplate() {
    setActive({ id: "", name: "Untitled template", subject: "", body: "", updatedAt: "" });
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      const d = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id || undefined, name: active.name, subject: active.subject, body: active.body }),
      }).then((r) => r.json());
      await load(d.template?.id);
    } finally { setSaving(false); }
  }

  async function del() {
    if (!active?.id) { setActive(null); return; }
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates?id=${active.id}`, { method: "DELETE" });
    await load();
  }

  function insertField(f: string) {
    if (!active) return;
    setActive({ ...active, body: active.body + `{{${f}}}` });
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Mail Templates</h1>
          <p className="text-sm text-muted mt-1">Write once, personalize per founder with merge fields.</p>
        </div>
        <button className="btn btn-ghost" onClick={newTemplate}><Plus className="w-4 h-4" /> New template</button>
      </div>

      <div className="grid md:grid-cols-[200px_1fr_1fr] gap-5">
        {/* List */}
        <div className="space-y-1">
          {templates.map((t) => (
            <button key={t.id} onClick={() => setActive(t)}
              className={`w-full text-left p-3 rounded-lg border text-sm ${active?.id === t.id ? "border-primary bg-indigo-50" : "border-border-soft hover:bg-slate-50"}`}>
              <div className="flex items-center gap-2 font-medium"><FileText className="w-4 h-4 text-muted" />{t.name}</div>
            </button>
          ))}
          {templates.length === 0 && <p className="text-sm text-muted">No templates yet.</p>}
        </div>

        {/* Editor */}
        {active ? (
          <>
            <div className="card p-5 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-1">Template name</label>
                <input className="input" value={active.name} onChange={(e) => setActive({ ...active, name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">Subject line</label>
                <input className="input" value={active.subject} onChange={(e) => setActive({ ...active, subject: e.target.value })} placeholder="Quick idea for {{company}}" />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">Body</label>
                <textarea className="textarea font-mono text-[13px]" rows={14} value={active.body} onChange={(e) => setActive({ ...active, body: e.target.value })} />
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Insert merge field:</div>
                <div className="flex flex-wrap gap-2">
                  {MERGE_FIELDS.map((f) => (
                    <button key={f} className="chip" onClick={() => insertField(f)}>{`{{${f}}}`}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                </button>
                <button className="btn btn-ghost" onClick={del}><Trash2 className="w-4 h-4" /> Delete</button>
              </div>
            </div>

            {/* Live preview */}
            <div className="card p-5">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Live preview</div>
              <div className="border border-border-soft rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border-soft bg-slate-50">
                  <div className="text-xs text-muted">Subject</div>
                  <div className="font-semibold text-sm">{render(active.subject) || <span className="text-muted">—</span>}</div>
                </div>
                <div className="p-4 text-sm whitespace-pre-wrap leading-relaxed">
                  {render(active.body) || <span className="text-muted">Start typing the body…</span>}
                </div>
              </div>
              <p className="text-xs text-muted mt-3">Preview uses sample founder <strong>Sofia Garcia, Nova Labs</strong>. Each recipient gets their own values at send time.</p>
            </div>
          </>
        ) : (
          <div className="card p-8 text-center text-muted col-span-2">Select or create a template to start editing.</div>
        )}
      </div>
    </div>
  );
}
