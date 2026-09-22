"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Copy, Check, Send, Save, RotateCcw, AlertTriangle, Sparkles, Linkedin, Globe } from "lucide-react";
import { ANGLES, compose, defaultAngle, detectRole, toTemplate } from "@/lib/drafter/compose";
import { splitName } from "@/lib/drafter/linkedin";
import { OFFERINGS } from "@/lib/drafter/offerings";
import { mailboxForCategories } from "@/lib/mailbox-match";
import type { DraftAudit, Offering, ResearchResult } from "@/lib/drafter/types";

const ORDER: Offering[] = ["brandvibe", "maveriko", "xambaaz"];

export default function DrafterPage() {
  const [offering, setOffering] = useState<Offering>("brandvibe");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [to, setTo] = useState("");

  // What we know about them — filled by Research, always editable.
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [about, setAbout] = useState("");
  const [companyHint, setCompanyHint] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [site, setSite] = useState({ website: "", host: "" });
  const [audit, setAudit] = useState<DraftAudit | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [researching, setResearching] = useState(false);

  const [angle, setAngle] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);

  const [mailboxes, setMailboxes] = useState<{ id: string; label: string }[]>([]);
  const [fromMailbox, setFromMailbox] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "save">("");
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/mailboxes").then((r) => r.json()).then((d) => setMailboxes(d.mailboxes ?? [])).catch(() => {});
  }, []);
  // Sender follows the brand: XamBaaz mail from the XamBaaz mailbox, and so on.
  useEffect(() => {
    if (mailboxes.length) setFromMailbox(mailboxForCategories(OFFERINGS[offering].categories, mailboxes) ?? mailboxes[0].id);
  }, [offering, mailboxes]);

  const person = useMemo(() => {
    const { name: n, firstName } = splitName(name);
    return { name: n, firstName, headline, about, companyHint };
  }, [name, headline, about, companyHint]);
  const company = useMemo(
    () => ({ name: companyName, website: site.website, host: site.host, tagline, hasBlog: false }),
    [companyName, site, tagline],
  );
  const role = useMemo(() => detectRole(person, company), [person, company]);
  const activeAngle = ANGLES[offering].some((a) => a.id === angle) ? angle : defaultAngle(offering, role);
  const draft = useMemo(
    () => compose({ offering, angle: activeAngle, person, company, audit: offering === "maveriko" ? audit : null }),
    [offering, activeAngle, person, company, audit],
  );

  // Re-draft whenever the inputs change — unless he has edited the text by hand, in
  // which case keep his words and offer a one-click reset instead of overwriting them.
  useEffect(() => {
    if (!edited) { setSubject(draft.subject); setBody(draft.body); }
  }, [draft, edited]);

  function pickOffering(o: Offering) {
    setOffering(o);
    setAngle("");
    setResult(null);
    if (o !== "maveriko") setAudit(null);
  }

  async function research() {
    setResearching(true); setNotes([]); setResult(null);
    try {
      const res = await fetch("/api/drafter/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkedinUrl, website, offering }),
      });
      const d = await res.json();
      if (!res.ok) { setNotes([d.error || "Research failed."]); return; }
      const r = d as ResearchResult;
      // Only overwrite a field when research actually found something for it.
      if (r.person.name) setName(r.person.name);
      if (r.person.headline) setHeadline(r.person.headline);
      setAbout(r.person.about || "");
      setCompanyHint(r.person.companyHint || "");
      if (r.company.name) setCompanyName(r.company.name);
      else if (!companyName && r.person.companyHint) setCompanyName(r.person.companyHint);
      setTagline(r.company.tagline || "");
      setSite({ website: r.company.website, host: r.company.host });
      setAudit(r.audit);
      setNotes([r.linkedinNote, r.websiteNote, r.auditNote].filter(Boolean));
      setAngle("");
      setEdited(false);
    } catch {
      setNotes(["Research failed — check your connection and try again."]);
    } finally {
      setResearching(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setResult({ ok: false, text: "Your browser blocked the clipboard — select the text and copy it by hand." });
    }
  }

  async function send() {
    if (!to.trim()) { setResult({ ok: false, text: "Add their email address to send." }); return; }
    if (!confirm(`Send this email to ${to.trim()} from ${fromMailbox || "the default mailbox"}?`)) return;
    setBusy("send"); setResult(null);
    try {
      const res = await fetch("/api/drafter/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject, body, offering, mailboxId: fromMailbox, linkedinUrl, person, company }),
      });
      const d = await res.json();
      if (!res.ok) { setResult({ ok: false, text: d.error || "Send failed." }); return; }
      setResult({
        ok: true,
        text: d.simulated
          ? "Simulated only — no mailbox is configured here, so nothing actually went out."
          : `Sent from ${d.from}. ${d.sentToday}/${d.cap} drafter sends used today.`,
      });
    } catch {
      setResult({ ok: false, text: "Send failed — check your connection." });
    } finally {
      setBusy("");
    }
  }

  async function saveTemplate() {
    setBusy("save"); setResult(null);
    try {
      const label = OFFERINGS[offering].label;
      const res = await fetch("/api/templates", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${label} — ${companyName || "drafted"} (drafter)`,
          subject: toTemplate(subject, person, companyName),
          body: toTemplate(body, person, companyName),
          format: "plain",
          track: true,
          category: OFFERINGS[offering].categories[0],
        }),
      });
      const d = await res.json();
      if (!res.ok) { setResult({ ok: false, text: d.error || "Couldn't save the template." }); return; }
      const swapped = [person.firstName && "their first name → {{first_name}}", companyName && "the company → {{company}}"].filter(Boolean).join(", ");
      setResult({ ok: true, text: `Saved to Mail Templates under “${OFFERINGS[offering].categories[0]}”${swapped ? ` (${swapped}, so it's reusable)` : ""}.` });
    } finally {
      setBusy("");
    }
  }

  const canResearch = !!(linkedinUrl.trim() || website.trim()) && !researching;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Email Drafter</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl">
          Paste someone&apos;s LinkedIn link and their company website, pick what you&apos;re selling, and get a
          personal email built only from what&apos;s genuinely on their profile and site. Nothing is made up —
          every personal line shows where it came from.
        </p>
      </div>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        {/* Inputs */}
        <div className="space-y-5">
          <div className="card p-5 space-y-3">
            <div className="text-sm font-semibold">1. What are you selling?</div>
            <div className="grid grid-cols-3 gap-2">
              {ORDER.map((o) => (
                <button key={o} onClick={() => pickOffering(o)}
                  className={`p-2.5 rounded-lg border text-left ${offering === o ? "border-primary bg-indigo-50" : "border-border-soft hover:bg-slate-50"}`}>
                  <div className="text-sm font-semibold">{OFFERINGS[o].label}</div>
                  <div className="text-[11px] text-muted leading-snug mt-0.5">{OFFERINGS[o].blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div className="text-sm font-semibold">2. Who is it for?</div>
            <label className="block">
              <span className="text-xs text-muted flex items-center gap-1"><Linkedin className="w-3.5 h-3.5" /> LinkedIn profile link</span>
              <input className="input mt-1" placeholder="linkedin.com/in/…" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-muted flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Company website</span>
              <input className="input mt-1" placeholder="acme.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            <button className="btn btn-primary w-full justify-center" onClick={research} disabled={!canResearch}>
              {researching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {researching ? (offering === "maveriko" ? "Researching + auditing their site (~20 s)…" : "Researching…") : "Research"}
            </button>
            {notes.length > 0 && (
              <div className="space-y-1">
                {notes.map((n, i) => (
                  <p key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">{n}</p>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-3">
            <div className="text-sm font-semibold">3. Check what we know <span className="font-normal text-muted">(edit anything)</span></div>
            <label className="block"><span className="text-xs text-muted">Their name</span>
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha Rao" />
            </label>
            <label className="block"><span className="text-xs text-muted">Their headline / role</span>
              <input className="input mt-1" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Founder & CEO at Acme" />
            </label>
            <label className="block"><span className="text-xs text-muted">Company name</span>
              <input className="input mt-1" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme" />
            </label>
            <label className="block"><span className="text-xs text-muted">What the company says it does <span className="text-slate-400">(quoted from their site)</span></span>
              <textarea className="textarea mt-1" rows={2} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Left blank if their site didn't say" />
            </label>
            {offering === "maveriko" && audit && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-2">
                Audited {site.host}: {audit.seoScore}/100 search, {audit.geoScore}/100 AI readiness.
              </p>
            )}
          </div>
        </div>

        {/* Draft */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold mr-1">Angle</span>
              {ANGLES[offering].map((a) => (
                <button key={a.id} title={a.hint} onClick={() => { setAngle(a.id); setEdited(false); }}
                  className={`chip ${activeAngle === a.id ? "!border-primary !bg-indigo-50 font-semibold" : ""}`}>
                  {a.label}
                </button>
              ))}
              {edited && (
                <button className="btn btn-ghost !py-1 !px-2 ml-auto text-xs" onClick={() => setEdited(false)} title="Throw away your edits and rebuild from the facts">
                  <RotateCcw className="w-3.5 h-3.5" /> Re-draft
                </button>
              )}
            </div>

            <label className="block"><span className="text-xs text-muted">Subject</span>
              <input className="input mt-1" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} />
            </label>
            <label className="block"><span className="text-xs text-muted">Email</span>
              <textarea className="textarea mt-1 text-[14px] leading-relaxed" rows={18} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
            </label>

            {draft.used.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Personalised with</span>
                {draft.used.map((u) => <span key={u} className="badge" style={{ background: "#eef2ff", color: "#4338ca" }}>{u}</span>)}
              </div>
            )}
            {draft.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}</p>
            ))}
          </div>

          <div className="card p-5 space-y-3">
            <div className="text-sm font-semibold">4. Use it</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-xs text-muted">Their email <span className="text-slate-400">(only needed to send)</span></span>
                <input className="input mt-1" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="asha@acme.com" />
              </label>
              <label className="block"><span className="text-xs text-muted">Send from</span>
                <select className="select mt-1" value={fromMailbox} onChange={(e) => setFromMailbox(e.target.value)}>
                  {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost" onClick={copy}>
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn btn-ghost" onClick={saveTemplate} disabled={busy !== "" || !subject || !body}>
                {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save as template
              </button>
              <button className="btn btn-primary" onClick={send} disabled={busy !== "" || !subject || !body}>
                {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
              </button>
            </div>
            {result && (
              <p className={`text-sm rounded-md p-2 border ${result.ok ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-rose-800 bg-rose-50 border-rose-200"}`}>
                {result.text}{result.ok && result.text.startsWith("Saved") && <> <Link href="/templates" className="underline">Open templates</Link></>}
              </p>
            )}
            <p className="text-[11px] text-muted">
              One-off sends aren&apos;t part of a campaign, so they don&apos;t show in campaign stats or automatic reply
              tracking — replies arrive in the brand mailbox as normal. Sends are checked against your unsubscribe list,
              blocked on Sundays, and capped at 25 a day.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
