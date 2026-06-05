"use client";

import { useEffect, useState } from "react";
import { FileText, Plus, Save, Trash2, Loader2, Megaphone } from "lucide-react";
import type { Template } from "@/lib/types";

const MERGE_FIELDS = ["first_name", "name", "company", "title", "city", "country"];
const SAMPLE: Record<string, string> = {
  first_name: "Sofia", name: "Sofia Garcia", company: "Nova Labs",
  title: "Founder & CEO", city: "San Francisco", country: "United States",
};
const BRAND = "Brand Vibe"; // header shown in the newsletter preview (real send uses EMAIL_FROM name)

const NEWSLETTER_STARTER = {
  name: "Company Update / Newsletter",
  subject: "{{first_name}}, a quick update from Brand Vibe",
  body: `Hi {{first_name}},

Hope you're having a great week. Here's a short update from our side — no fluff, just the things we thought you'd want to know.

What's new
We've been heads-down shipping improvements based on what we keep hearing from people like you. The goal stays the same: help you get more done with less effort.

A few highlights
• Faster, simpler workflows so you spend less time on setup.
• New capabilities for the use-cases you asked about most.
• Lots of small touches that make the day-to-day smoother.

If any of this lines up with what you're working on right now, we'd love to show you around — it takes 15 minutes and there's zero pressure. Just reply to this email and we'll find a time.

Warm regards,
The Brand Vibe Team`,
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
    setActive({ id: "", name: "Untitled template", subject: "", body: "", type: "outreach", updatedAt: "" });
  }

  function newNewsletter() {
    setActive({ id: "", ...NEWSLETTER_STARTER, type: "newsletter", updatedAt: "" });
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      const d = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id || undefined, name: active.name, subject: active.subject, body: active.body, type: active.type || "outreach" }),
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
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={newNewsletter}><Megaphone className="w-4 h-4" /> New newsletter</button>
          <button className="btn btn-ghost" onClick={newTemplate}><Plus className="w-4 h-4" /> New template</button>
        </div>
      </div>

      <div className="grid md:grid-cols-[200px_1fr_1fr] gap-5">
        {/* List */}
        <div className="space-y-1">
          {templates.map((t) => (
            <button key={t.id} onClick={() => setActive(t)}
              className={`w-full text-left p-3 rounded-lg border text-sm ${active?.id === t.id ? "border-primary bg-indigo-50" : "border-border-soft hover:bg-slate-50"}`}>
              <div className="flex items-center gap-2 font-medium">
                {t.type === "newsletter" ? <Megaphone className="w-4 h-4 text-indigo-500" /> : <FileText className="w-4 h-4 text-muted" />}
                <span className="flex-1 truncate">{t.name}</span>
              </div>
              {t.type === "newsletter" && <span className="text-[10px] uppercase tracking-wide text-indigo-500 font-semibold mt-1 inline-block">Newsletter</span>}
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
                {active.type === "newsletter" ? (
                  <div className="bg-slate-100 p-3">
                    <div className="max-w-full mx-auto bg-white rounded-xl overflow-hidden border border-border-soft">
                      <div className="bg-indigo-600 px-5 py-3 text-white font-bold text-[15px]">{BRAND}</div>
                      <div className="p-5 text-[13px] leading-relaxed text-slate-800 space-y-3">
                        {(render(active.body) || "Start typing the body…").split(/\n{2,}/).map((blk, i) => (
                          <p key={i} className="whitespace-pre-wrap">{blk}</p>
                        ))}
                      </div>
                      <div className="px-5 py-3 border-t border-border-soft text-[11px] text-slate-400">You&apos;re receiving this update from {BRAND}. Just reply to this email to reach us.</div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-sm whitespace-pre-wrap leading-relaxed">
                    {render(active.body) || <span className="text-muted">Start typing the body…</span>}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted mt-3">
                {active.type === "newsletter"
                  ? <>Sends as a <strong>styled newsletter</strong> to everyone on the campaign&apos;s list(s) — personalized by first name. Edit the body freely; blank lines start new paragraphs.</>
                  : <>Preview uses sample founder <strong>Sofia Garcia, Nova Labs</strong>. Each recipient gets their own values at send time.</>}
              </p>
            </div>
          </>
        ) : (
          <div className="card p-8 text-center text-muted col-span-2">Select or create a template to start editing.</div>
        )}
      </div>
    </div>
  );
}
