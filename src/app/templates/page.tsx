"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Save, Trash2, Loader2, Megaphone, Mail, Sparkles, ShieldCheck, AlertTriangle, CheckCircle2, TrendingUp, Copy, Library, X } from "lucide-react";
import type { Template } from "@/lib/types";
import type { LibraryTemplate } from "@/lib/templateLibrary";

type Perf = { id: string; campaigns: number; sent: number; opened: number; clicked: number; replied: number };

type Format = "plain" | "rich" | "newsletter";

const MERGE_FIELDS = ["first_name", "name", "company", "title", "city", "country"];
const SAMPLE: Record<string, string> = {
  first_name: "Sofia", name: "Sofia Garcia", company: "Nova Labs",
  title: "Founder & CEO", city: "San Francisco", country: "United States",
};
const BRAND = "Brand Vibe"; // header shown in the newsletter preview (real send uses EMAIL_FROM name)

const FORMATS: { id: Format; label: string; hint: string; icon: typeof Mail }[] = [
  { id: "plain", label: "Plain", hint: "Looks hand-typed — best inboxing for 1:1 cold mail", icon: Mail },
  { id: "rich", label: "Rich", hint: "Light styling, tracking on", icon: FileText },
  { id: "newsletter", label: "Newsletter", hint: "Branded card for broadcasts", icon: Megaphone },
];

const UNCATEGORISED = "Uncategorised";

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

const PLAIN_STARTER = {
  name: "Untitled — cold mail",
  subject: "{Quick|A quick} thought for {{company}}",
  body: `Hi {{first_name}},

{Quick note|A quick note}, founder to founder — I'll keep it short.

[one specific, relevant line about {{company}}]

[the single thing you do for them, in one sentence]

{Worth a quick chat|Open to a 15-min call} to see if it's a fit? If not, a one-line "no" is a perfectly good answer.

Best,
[Your name]`,
};

const fmtOf = (t: Template): Format => t.format || (t.type === "newsletter" ? "newsletter" : "rich");
const trackOf = (t: Template): boolean => (typeof t.track === "boolean" ? t.track : fmtOf(t) !== "plain");

// Resolve {a|b|c} spintax deterministically (mirror of server) so the preview is stable.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function spin(text: string, seed: string): string {
  const re = /\{([^{}]*\|[^{}]*)\}/;
  let out = text, n = 0, g = 0;
  while (re.test(out) && g++ < 500) out = out.replace(re, (_, b: string) => { const o = b.split("|"); return o[hashStr(`${seed}:${n++}`) % o.length]; });
  return out;
}
function render(text: string, seed = "preview") {
  return spin(text, seed).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`);
}
function spinCount(text: string): number {
  return (text.match(/\{[^{}]*\|[^{}]*\}/g) || []).length;
}

// Lightweight deliverability / spam-score linter — guides toward human, inboxing copy.
const SPAM_WORDS = ["free", "guarantee", "guaranteed", "act now", "limited time", "click here", "buy now", "order now", "winner", "congratulations", "risk-free", "100%", "cash", "earn $", "cheap", "discount", "offer expires", "urgent", "no obligation", "double your", "make money", "credit card", "this is not spam", "amazing", "incredible deal"];
type LintItem = { level: "bad" | "warn" | "good"; text: string };
function lint(subject: string, body: string, format: Format, track: boolean): { score: number; items: LintItem[] } {
  const items: LintItem[] = [];
  let penalty = 0;
  const text = `${subject}\n${body}`;
  const low = text.toLowerCase();

  const hits = SPAM_WORDS.filter((w) => low.includes(w));
  if (hits.length) { penalty += Math.min(30, hits.length * 8); items.push({ level: "bad", text: `Spam-trigger words: ${hits.slice(0, 4).join(", ")}${hits.length > 4 ? "…" : ""}` }); }

  const caps = (body.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => w !== "NCERT");
  if (caps.length) { penalty += 8; items.push({ level: "warn", text: `ALL-CAPS words (${caps.length}) read as shouty/spammy` }); }

  const bangs = (text.match(/!/g) || []).length;
  if (bangs > 2) { penalty += 8; items.push({ level: "warn", text: `${bangs} exclamation marks — keep it calm (≤1)` }); }

  if (subject.length > 60) { penalty += 6; items.push({ level: "warn", text: `Subject is ${subject.length} chars — aim for ≤55 so it isn't cut off` }); }
  if (!subject.trim()) { penalty += 10; items.push({ level: "bad", text: "Empty subject line" }); }

  const links = (body.match(/(https?:\/\/|www\.)/gi) || []).length;
  if (links > 3) { penalty += 10; items.push({ level: "warn", text: `${links} links — too many hurts deliverability (1–2 is ideal)` }); }

  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words > 200) { penalty += 8; items.push({ level: "warn", text: `Body is ${words} words — short (≤150) gets more replies` }); }
  if (words > 0 && words < 15) { penalty += 4; items.push({ level: "warn", text: "Very short body — may look thin/templated" }); }

  if (!/\{\{\s*first_name\s*\}\}/.test(body) && !/\{\{\s*first_name\s*\}\}/.test(subject)) {
    penalty += 8; items.push({ level: "warn", text: "No {{first_name}} — personalization lifts opens & looks human" });
  }
  if (format !== "plain" && track) items.push({ level: "warn", text: "Tracking pixel + link rewriting is a mild spam signal — use Plain + tracking off for cold 1:1" });

  // Positive signals
  if (spinCount(text) > 0) items.push({ level: "good", text: `${spinCount(text)} spintax variant${spinCount(text) > 1 ? "s" : ""} — each recipient gets different wording (great for inboxing)` });
  if (format === "plain" && !track) items.push({ level: "good", text: "Plain + no tracking = most human, best inbox placement" });
  if (!hits.length && bangs <= 1) items.push({ level: "good", text: "Clean, non-spammy tone" });

  return { score: Math.max(0, 100 - penalty), items };
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [active, setActive] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [perf, setPerf] = useState<Record<string, Perf>>({});
  const [library, setLibrary] = useState<LibraryTemplate[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  async function load(selectId?: string) {
    const d = await fetch("/api/templates").then((r) => r.json());
    setTemplates(d.templates ?? []);
    const sel = selectId ? d.templates.find((t: Template) => t.id === selectId) : d.templates?.[0];
    setActive(sel ?? null);
    fetch("/api/templates/performance").then((r) => r.json())
      .then((p) => setPerf(Object.fromEntries((p.performance ?? []).map((x: Perf) => [x.id, x]))))
      .catch(() => {});
  }
  useEffect(() => {
    load();
    fetch("/api/templates/library").then((r) => r.json()).then((d) => setLibrary(d.library ?? [])).catch(() => {});
  }, []);

  function newTemplate() {
    setActive({ id: "", ...PLAIN_STARTER, type: "outreach", format: "plain", track: false, category: active?.category ?? null, updatedAt: "" });
  }
  function newNewsletter() {
    setActive({ id: "", ...NEWSLETTER_STARTER, type: "newsletter", format: "newsletter", track: true, category: null, updatedAt: "" });
  }
  // Copy the open mail into a new, unsaved one — the quickest way to add a 3rd/4th
  // angle to a category without retyping the parts that already work.
  function duplicate() {
    if (!active) return;
    setActive({ ...active, id: "", name: `${active.name} (copy)`, updatedAt: "" });
  }
  // Instantiate a starter preset as a fresh, fully editable template.
  async function addFromLibrary(p: LibraryTemplate) {
    setShowLibrary(false);
    setSaving(true);
    try {
      const d = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, subject: p.subject, body: p.body, format: p.format, track: p.track, category: p.category }),
      }).then((r) => r.json());
      await load(d.template?.id);
    } finally { setSaving(false); }
  }

  function setFormat(format: Format) {
    if (!active) return;
    setActive({ ...active, format, type: format === "newsletter" ? "newsletter" : "outreach", track: format !== "plain" });
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      const d = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id || undefined, name: active.name, subject: active.subject, body: active.body, format: fmtOf(active), track: trackOf(active), category: active.category ?? null }),
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

  function insert(snippet: string) {
    if (!active) return;
    setActive({ ...active, body: active.body + snippet });
  }

  const format = active ? fmtOf(active) : "plain";
  const track = active ? trackOf(active) : false;
  const report = useMemo(() => active ? lint(active.subject, active.body, format, track) : null, [active, format, track]);

  // Group the sidebar by category. The API already returns category order, so a single
  // pass preserves it; uncategorised mails fall to the bottom.
  const groups = useMemo(() => {
    const g = new Map<string, Template[]>();
    for (const t of templates) {
      const k = t.category || UNCATEGORISED;
      (g.get(k) ?? g.set(k, []).get(k)!).push(t);
    }
    return [...g.entries()];
  }, [templates]);

  // Every category currently in use — powers the datalist so an existing category is
  // one click and a brand-new one is just typing.
  const knownCategories = useMemo(() => {
    const s = new Set<string>();
    for (const t of templates) if (t.category) s.add(t.category);
    for (const p of library) s.add(p.category);
    return [...s].sort();
  }, [templates, library]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Mail Templates</h1>
          <p className="text-sm text-muted mt-1">Saved mails grouped by category. Personalized per recipient with merge fields &amp; <code>{`{spintax}`}</code> variation.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setShowLibrary(true)}><Library className="w-4 h-4" /> Library</button>
          <button className="btn btn-ghost" onClick={newNewsletter}><Megaphone className="w-4 h-4" /> New newsletter</button>
          <button className="btn btn-primary" onClick={newTemplate}><Plus className="w-4 h-4" /> New mail</button>
        </div>
      </div>

      {/* Starter library — add another copy of a preset, or restore a deleted one */}
      {showLibrary && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 font-semibold"><Library className="w-[18px] h-[18px] text-primary" /> Starter mail library</div>
            <button className="btn btn-ghost" onClick={() => setShowLibrary(false)}><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-muted mb-3">Click one to add an editable copy. Use these as the base for a new angle or a new category.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {library.map((p) => (
              <button key={p.key} onClick={() => addFromLibrary(p)} disabled={saving}
                className="text-left p-3 rounded-lg border border-border-soft hover:border-primary hover:bg-indigo-50 disabled:opacity-50">
                <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">{p.category}</div>
                <div className="text-sm font-medium mt-0.5">{p.name}</div>
                <div className="text-xs text-muted mt-1 line-clamp-2">{render(p.subject)}</div>
              </button>
            ))}
            {library.length === 0 && <p className="text-sm text-muted">Library unavailable.</p>}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-[200px_1fr_1fr] gap-5">
        {/* List */}
        <div className="space-y-4">
          {groups.map(([cat, items]) => (
            <div key={cat}>
              <div className="text-[10px] uppercase tracking-wide text-muted font-bold px-1 mb-1.5 flex items-center justify-between">
                <span className="truncate">{cat}</span><span className="text-slate-300">{items.length}</span>
              </div>
              <div className="space-y-1">
                {items.map((t) => (
                  <button key={t.id} onClick={() => setActive(t)} title={t.name}
                    className={`w-full text-left p-3 rounded-lg border text-sm ${active?.id === t.id ? "border-primary bg-indigo-50" : "border-border-soft hover:bg-slate-50"}`}>
                    <div className="flex items-center gap-2 font-medium">
                      {fmtOf(t) === "newsletter" ? <Megaphone className="w-4 h-4 text-indigo-500" /> : fmtOf(t) === "plain" ? <Mail className="w-4 h-4 text-emerald-500" /> : <FileText className="w-4 h-4 text-muted" />}
                      <span className="flex-1 truncate">{t.name}</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-muted font-semibold mt-1 inline-block">{fmtOf(t)}</span>
                    {(perf[t.id]?.sent ?? 0) > 0 && (
                      <div className="text-[10px] text-muted mt-0.5">
                        {perf[t.id].sent} sent · {Math.round((perf[t.id].opened / perf[t.id].sent) * 100)}% open · {perf[t.id].replied} repl{perf[t.id].replied === 1 ? "y" : "ies"}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {templates.length === 0 && <p className="text-sm text-muted">No mails yet — open the Library to add one.</p>}
        </div>

        {/* Editor */}
        {active ? (
          <>
            <div className="card p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold block mb-1">Mail name</label>
                  <input className="input" value={active.name} onChange={(e) => setActive({ ...active, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-semibold block mb-1">Category</label>
                  <input className="input" list="template-categories" placeholder="e.g. AI Consulting"
                    value={active.category ?? ""} onChange={(e) => setActive({ ...active, category: e.target.value })} />
                  <datalist id="template-categories">
                    {knownCategories.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>

              {/* Format selector */}
              <div>
                <label className="text-sm font-semibold block mb-1">Format</label>
                <div className="grid grid-cols-3 gap-2">
                  {FORMATS.map((f) => {
                    const Icon = f.icon;
                    return (
                      <button key={f.id} onClick={() => setFormat(f.id)} title={f.hint}
                        className={`p-2 rounded-lg border text-center text-xs ${format === f.id ? "border-primary bg-indigo-50 font-semibold" : "border-border-soft hover:bg-slate-50"}`}>
                        <Icon className="w-4 h-4 mx-auto mb-1" />{f.label}
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 mt-2 text-xs text-muted cursor-pointer">
                  <input type="checkbox" checked={track} onChange={(e) => setActive({ ...active, track: e.target.checked })} />
                  Open &amp; click tracking {track ? "on" : "off"} <span className="text-muted">— off looks more human (no pixel/redirects)</span>
                </label>
              </div>

              <div>
                <label className="text-sm font-semibold block mb-1">Subject line</label>
                <input className="input" value={active.subject} onChange={(e) => setActive({ ...active, subject: e.target.value })} placeholder="A quick idea for {{company}}" />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">Body</label>
                <textarea className="textarea font-mono text-[13px]" rows={13} value={active.body} onChange={(e) => setActive({ ...active, body: e.target.value })} />
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Insert merge field:</div>
                <div className="flex flex-wrap gap-2">
                  {MERGE_FIELDS.map((f) => (
                    <button key={f} className="chip" onClick={() => insert(`{{${f}}}`)}>{`{{${f}}}`}</button>
                  ))}
                  <button className="chip" onClick={() => insert("{Hi|Hello|Hey}")} title="Spintax: each recipient gets a random variant"><Sparkles className="w-3 h-3" /> spintax</button>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {active.id ? "Save" : "Save as new"}
                </button>
                <button className="btn btn-ghost" onClick={duplicate} title="Copy this mail into a new one — then edit and save"><Copy className="w-4 h-4" /> Duplicate</button>
                <button className="btn btn-ghost" onClick={del}><Trash2 className="w-4 h-4" /> Delete</button>
              </div>
            </div>

            {/* Live preview + deliverability */}
            <div className="space-y-4">
              {/* Real-world performance of this template */}
              {active.id && (perf[active.id]?.sent ?? 0) > 0 && (() => {
                const p = perf[active.id];
                const openPct = Math.round((p.opened / p.sent) * 100);
                const replyPct = Math.round((p.replied / p.sent) * 1000) / 10;
                const hint = openPct < 30
                  ? "Low open rate → the subject line is the bottleneck. Try a shorter, curiosity-driven subject and add {a|b} spintax variants."
                  : p.replied === 0
                    ? "Good opens but no replies → the body/CTA is the bottleneck. Shorten it, make the ask smaller (one question), and personalize the first line."
                    : "This template is converting — keep it, and A/B a spintax variant of the subject to push opens higher.";
                return (
                  <div className="card p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Real results ({p.campaigns} campaign{p.campaigns > 1 ? "s" : ""})</div>
                    <div className="grid grid-cols-4 gap-2 text-center mb-2">
                      {[["Sent", p.sent], ["Open %", `${openPct}%`], ["Clicks", p.clicked], ["Reply %", `${replyPct}%`]].map(([k, v]) => (
                        <div key={k as string} className="rounded-lg bg-slate-50 py-2">
                          <div className="font-bold text-sm">{v as string | number}</div>
                          <div className="text-[10px] text-muted">{k as string}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted">{hint}</p>
                  </div>
                );
              })()}

              {/* Deliverability score */}
              {report && (
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="w-4 h-4 text-indigo-500" /> Deliverability check</div>
                    <div className={`text-sm font-bold ${report.score >= 85 ? "text-emerald-600" : report.score >= 65 ? "text-amber-600" : "text-rose-600"}`}>{report.score}/100</div>
                  </div>
                  <div className="space-y-1">
                    {report.items.map((it, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        {it.level === "good" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${it.level === "bad" ? "text-rose-500" : "text-amber-500"}`} />}
                        <span className={it.level === "good" ? "text-muted" : ""}>{it.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live preview */}
              <div className="card p-5">
                <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Live preview</div>
                <div className="border border-border-soft rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border-soft bg-slate-50">
                    <div className="text-xs text-muted">Subject</div>
                    <div className="font-semibold text-sm">{render(active.subject) || <span className="text-muted">—</span>}</div>
                  </div>
                  {format === "newsletter" ? (
                    <div className="bg-slate-100 p-3">
                      <div className="max-w-full mx-auto bg-white rounded-xl overflow-hidden border border-border-soft">
                        <div className="bg-indigo-600 px-5 py-3 text-white font-bold text-[15px]">{BRAND}</div>
                        <div className="p-5 text-[13px] leading-relaxed text-slate-800 space-y-3">
                          {(render(active.body) || "Start typing the body…").split(/\n{2,}/).map((blk, i) => (
                            <p key={i} className="whitespace-pre-wrap">{blk}</p>
                          ))}
                        </div>
                        <div className="px-5 py-3 border-t border-border-soft text-[11px] text-slate-400">You&apos;re receiving this update from {BRAND}. Just reply to this email to reach us, or unsubscribe.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-sm whitespace-pre-wrap leading-relaxed">
                      {render(active.body) || <span className="text-muted">Start typing the body…</span>}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted mt-3">
                  Preview for sample <strong>Sofia Garcia, Nova Labs</strong> (one spintax variant shown). Each recipient gets their own merge values and a different spin at send time.
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="card p-8 text-center text-muted col-span-2">Select or create a template to start editing.</div>
        )}
      </div>
    </div>
  );
}
