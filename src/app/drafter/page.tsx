"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2, Search, Copy, Check, Send, Save, RotateCcw, AlertTriangle, Sparkles, Linkedin, Globe,
  CheckCircle2, Eraser, Gauge, Info,
} from "lucide-react";
import { ANGLES, compose, defaultAngle, detectRole, personalLeftovers, templateDraft, toTemplate } from "@/lib/drafter/compose";
import { normalizeLinkedInUrl, splitName } from "@/lib/drafter/linkedin";
import { OFFERINGS } from "@/lib/drafter/offerings";
import { mailboxForCategories } from "@/lib/mailbox-match";
import { errorText, getJson } from "@/lib/client-fetch";
import type { DraftAudit, Offering, ResearchResult } from "@/lib/drafter/types";

const ORDER: Offering[] = ["brandvibe", "maveriko", "xambaaz"];
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

type Status = { sentToday: number; cap: number; sundayBlocked: boolean };
type SourceState = { label: string; ok: boolean; note: string };

/** POST JSON; never throws on a non-JSON reply (e.g. a Vercel timeout page). */
async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: `The server didn't answer (HTTP ${res.status}) — try again.` }; }
  return { ok: res.ok, status: res.status, data };
}

/** "Asha Rao <asha@acme.com>" → "asha@acme.com" — people paste straight from their mail app. */
const bareAddress = (s: string) => (s.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? s).replace(/^mailto:/i, "").trim();

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
  const [sources, setSources] = useState<SourceState[]>([]);
  const [researchError, setResearchError] = useState("");
  const [researching, setResearching] = useState(false);
  // The links the facts above came from. Research only re-reads what changed, so it
  // never wipes a headline he typed in for a person whose link hasn't changed.
  const [last, setLast] = useState({ li: "", web: "" });

  const [angle, setAngle] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);

  const [mailboxes, setMailboxes] = useState<{ id: string; label: string }[] | null>(null);
  const [mailboxError, setMailboxError] = useState("");
  const [fromMailbox, setFromMailbox] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"" | "send" | "save">("");
  const [copied, setCopied] = useState<"" | "subject" | "body">("");
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: "templates"; sent?: boolean } | null>(null);

  const loadStatus = () =>
    getJson<Status>("/api/drafter/send").then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    getJson<{ mailboxes?: { id: string; label: string }[] }>("/api/mailboxes")
      .then((d) => setMailboxes(d.mailboxes ?? []))
      .catch((e) => setMailboxError(errorText(e)));
    loadStatus();
  }, []);
  // Sender follows the brand: XamBaaz mail from the XamBaaz mailbox, and so on.
  useEffect(() => {
    if (mailboxes?.length) setFromMailbox(mailboxForCategories(OFFERINGS[offering].categories, mailboxes) ?? mailboxes[0].id);
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
  const composeInput = useMemo(
    () => ({ offering, angle: activeAngle, person, company, audit: offering === "maveriko" ? audit : null }),
    [offering, activeAngle, person, company, audit],
  );
  const draft = useMemo(() => compose(composeInput), [composeInput]);

  // Re-draft whenever the inputs change — unless he has edited the text by hand, in
  // which case keep his words and offer a one-click Re-draft instead of overwriting them.
  useEffect(() => {
    if (!edited) { setSubject(draft.subject); setBody(draft.body); }
  }, [draft, edited]);

  /** Anything that rebuilds the email asks first when it would throw away hand edits. */
  const okToRebuild = (why: string) => !edited || confirm(`${why}\n\nThis replaces the changes you typed into the email.`);

  function pickOffering(o: Offering) {
    if (o === offering || !okToRebuild(`Switch to ${OFFERINGS[o].label}?`)) return;
    setOffering(o);
    setAngle("");
    setEdited(false);
    setResult(null);
  }

  function pickAngle(id: string) {
    if (id === activeAngle || !okToRebuild("Switch angle?")) return;
    setAngle(id);
    setEdited(false);
  }

  const liNow = linkedinUrl.trim();
  const webNow = website.trim();
  const liInvalid = !!liNow && !normalizeLinkedInUrl(liNow);
  const needsAudit = offering === "maveriko" && !!site.host && !audit && webNow === last.web;

  async function research(mode: "auto" | "audit" = "auto") {
    let readLi = liNow !== last.li && !!liNow;
    let readWeb = webNow !== last.web && !!webNow;
    // Nothing new to read: he is asking for a fresh look at the same person.
    if (mode === "auto" && !readLi && !readWeb && !needsAudit) { readLi = !!liNow; readWeb = !!webNow; }
    const wantAudit = offering === "maveriko" && !!webNow && (readWeb || mode === "audit" || needsAudit);
    if (!readLi && !readWeb && !wantAudit) return;
    if ((readLi || readWeb) && !okToRebuild("Research and rebuild the email from what it finds?")) return;

    setResearching(true); setResearchError(""); setResult(null);
    try {
      const { ok, data } = await post("/api/drafter/research", {
        linkedinUrl: readLi ? liNow : "",
        website: readWeb || wantAudit ? webNow : "",
        offering,
      });
      if (!ok) { setResearchError(String(data.error || "Research failed — try again.")); return; }
      const r = data as unknown as ResearchResult;
      const next: SourceState[] = [];
      // A new link means a new person or company: replace every fact from that source,
      // blanks included, so nothing from the previous prospect survives into this email.
      if (readLi) {
        setName(r.person.name); setHeadline(r.person.headline);
        setAbout(r.person.about); setCompanyHint(r.person.companyHint);
        next.push({ label: "LinkedIn", ok: !r.linkedinBlocked, note: r.linkedinNote });
      }
      if (readWeb) {
        setCompanyName(r.company.name || (readLi ? r.person.companyHint : companyHint) || "");
        setTagline(r.company.tagline);
        setSite({ website: r.company.website, host: r.company.host });
        if (!wantAudit) setAudit(null); // a score for the old site must not follow the new one
        next.push({ label: "Website", ok: !r.websiteNote || !!r.company.name, note: r.websiteNote });
      } else if (readLi && !companyName && r.person.companyHint) {
        setCompanyName(r.person.companyHint);
      }
      if (wantAudit) {
        setAudit(r.audit);
        if (!readWeb && !site.host) setSite({ website: r.company.website, host: r.company.host });
        next.push({ label: "Site audit", ok: !!r.audit, note: r.auditNote });
      }
      setSources(next);
      setLast({ li: readLi ? liNow : last.li, web: readWeb || wantAudit ? webNow : last.web });
      // A new person or site gets a fresh draft (he agreed above). An audit alone keeps
      // his edits — the Rebuild banner offers to pull the scores in.
      if (readLi || readWeb) { setAngle(""); setEdited(false); }
    } catch {
      setResearchError("Research failed — check your connection and try again.");
    } finally {
      setResearching(false);
    }
  }

  function startOver() {
    const dirty = name || headline || companyName || tagline || liNow || webNow || to || edited;
    if (dirty && !confirm("Clear everything and start a new email?")) return;
    setLinkedinUrl(""); setWebsite(""); setTo("");
    setName(""); setHeadline(""); setAbout(""); setCompanyHint(""); setCompanyName(""); setTagline("");
    setSite({ website: "", host: "" }); setAudit(null); setSources([]); setResearchError("");
    setLast({ li: "", web: "" }); setAngle(""); setEdited(false); setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copy(what: "subject" | "body") {
    try {
      await navigator.clipboard.writeText(what === "subject" ? subject : body);
      setCopied(what);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      setResult({ ok: false, text: "Your browser blocked the clipboard — select the text and copy it by hand." });
    }
  }

  const toAddress = bareAddress(to);
  const toInvalid = !!to.trim() && !EMAIL_RE.test(toAddress);
  const fromLabel = mailboxes?.find((m) => m.id === fromMailbox)?.label || fromMailbox || "the brand's default mailbox";
  const left = status ? Math.max(0, status.cap - status.sentToday) : null;
  const sendBlocked = !!status?.sundayBlocked || left === 0;

  async function send(again = false) {
    if (!toAddress) { setResult({ ok: false, text: "Add their email address in step 5 to send." }); return; }
    if (toInvalid) { setResult({ ok: false, text: `“${to.trim()}” doesn't look like an email address.` }); return; }
    if (!again && !confirm(`Send “${subject}” to ${toAddress}\nfrom ${fromLabel}?`)) return;
    setBusy("send"); setResult(null);
    try {
      const { ok, data } = await post("/api/drafter/send", {
        to: toAddress, subject, body, offering, mailboxId: fromMailbox, linkedinUrl, person, company, again,
      });
      if (!ok && data.code === "already_sent") {
        setBusy("");
        if (confirm(`${data.error} Send it again anyway?`)) return send(true);
        setResult({ ok: false, text: "Not sent — you've emailed this person from the drafter before." });
        return;
      }
      if (!ok) { setResult({ ok: false, text: String(data.error || "Send failed.") }); return; }
      setResult({
        ok: true,
        sent: true,
        text: data.simulated
          ? "Simulated only — no mailbox is configured here, so nothing actually went out."
          : `Sent to ${toAddress} from ${data.from}. ${data.sentToday} of ${data.cap} one-off sends used today.`,
      });
    } catch {
      setResult({ ok: false, text: "Send failed — check your connection. If it might have gone, check the Sent folder before trying again." });
    } finally {
      setBusy("");
      loadStatus();
    }
  }

  async function saveTemplate() {
    const angleLabel = ANGLES[offering].find((a) => a.id === activeAngle)?.label ?? activeAngle;
    let t: { subject: string; body: string };
    let how: string;
    if (!edited) {
      // Untouched draft: rebuild it without this person's facts (see templateDraft).
      t = templateDraft(offering, activeAngle);
      how = `It's the general version — the lines about ${person.firstName || "this person"} were left out${offering === "xambaaz" ? "" : " and the greeting uses {{first_name}}"}.`;
    } else {
      const leftovers = personalLeftovers(`${subject}\n${body}`, composeInput);
      if (companyName && `${subject}\n${body}`.includes(companyName)) leftovers.push("their company name");
      if (leftovers.length && !confirm(
        `Your edited email still mentions ${leftovers.join(", ")} — true for ${person.firstName || "this person"} only, but a template goes to everyone on a list.\n\nSave it anyway? (You can tidy it in Mail Templates.)`,
      )) return;
      const firstOnly = { firstName: person.firstName };
      t = { subject: toTemplate(subject, firstOnly, ""), body: toTemplate(body, firstOnly, "") };
      if (offering === "xambaaz") t.body = t.body.replace(/^Dear \{\{first_name\}\},/, "Dear Principal,");
      how = leftovers.length ? "Check it in Mail Templates before using it on a list." : "Their first name became {{first_name}}.";
    }
    setBusy("save"); setResult(null);
    try {
      const templateName = `${OFFERINGS[offering].label} — ${angleLabel} (drafter)`;
      const { ok, data } = await post("/api/templates", {
        name: templateName, subject: t.subject, body: t.body, format: "plain", track: true,
        category: OFFERINGS[offering].categories[0],
      });
      if (!ok) { setResult({ ok: false, text: String(data.error || "Couldn't save the template.") }); return; }
      setResult({ ok: true, link: "templates", text: `Saved “${templateName}” to Mail Templates. ${how}` });
    } catch {
      setResult({ ok: false, text: "Couldn't save — check your connection and try again." });
    } finally {
      setBusy("");
    }
  }

  const knowsAnything = !!(name || headline || companyName || tagline || audit);
  const activeHint = ANGLES[offering].find((a) => a.id === activeAngle)?.hint;
  const canResearch = !!(liNow || webNow) && !researching && !liInvalid;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email Drafter</h1>
          <p className="text-sm text-muted mt-1 max-w-3xl">
            Write one personal email to one person. Paste their LinkedIn link and company website, pick what
            you&apos;re selling, and check the draft. Every personal line comes from their profile or their site, and
            the chips under the email show where each one came from. Nothing is made up.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={startOver} title="Clear the form for the next person">
          <Eraser className="w-4 h-4" /> New email
        </button>
      </div>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        {/* Inputs */}
        <div className="space-y-5">
          <div className="card p-5 space-y-3">
            <div className="text-sm font-semibold">1. What are you selling?</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Offering">
              {ORDER.map((o) => (
                <button key={o} role="radio" aria-checked={offering === o} onClick={() => pickOffering(o)}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${offering === o ? "border-primary bg-indigo-50 ring-1 ring-primary" : "border-border-soft hover:bg-slate-50"}`}>
                  <div className="text-sm font-semibold">{OFFERINGS[o].label}</div>
                  <div className="text-[11px] text-muted leading-snug mt-0.5">{OFFERINGS[o].blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <form className="card p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (canResearch) research(); }}>
            <div className="text-sm font-semibold">2. Who is it for?</div>
            <label className="block">
              <span className="text-xs text-muted flex items-center gap-1"><Linkedin className="w-3.5 h-3.5" /> Their LinkedIn profile</span>
              <input className="input mt-1" placeholder="linkedin.com/in/asha-rao" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
              {liInvalid && <span className="text-xs text-rose-700 mt-1 block">Use a personal profile link (linkedin.com/in/…). Company pages can&apos;t be read.</span>}
            </label>
            <label className="block">
              <span className="text-xs text-muted flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Their company website</span>
              <input className="input mt-1" placeholder="acme.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary w-full justify-center" disabled={!canResearch}>
              {researching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {researching ? (offering === "maveriko" && webNow ? "Reading + auditing their site (~20 s)…" : "Reading their profile and site…") : "Research"}
            </button>
            {!liNow && !webNow && <p className="text-[11px] text-muted">Either one is enough. You can also skip this and type their details in step 3.</p>}
            {researchError && <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md p-2">{researchError}</p>}
            {sources.length > 0 && (
              <ul className="space-y-1.5">
                {sources.map((s) => (
                  <li key={s.label} className={`text-xs rounded-md p-2 border flex gap-1.5 ${s.ok && !s.note ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-amber-800 bg-amber-50 border-amber-200"}`}>
                    {s.ok && !s.note ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                    <span><b>{s.label}:</b> {s.note || "read OK"}</span>
                  </li>
                ))}
              </ul>
            )}
          </form>

          <div className="card p-5 space-y-3">
            <div>
              <div className="text-sm font-semibold">3. Check the facts</div>
              <p className="text-[11px] text-muted mt-0.5">Filled in by Research. Fix anything wrong. The email updates as you type.</p>
            </div>
            <label className="block"><span className="text-xs text-muted">Their name</span>
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha Rao" />
            </label>
            <label className="block"><span className="text-xs text-muted">Their job title, as on LinkedIn</span>
              <input className="input mt-1" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Founder & CEO at Acme" />
            </label>
            <label className="block"><span className="text-xs text-muted">Company name</span>
              <input className="input mt-1" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme" />
            </label>
            <label className="block"><span className="text-xs text-muted">What the company says it does <span className="text-slate-400">(quoted word for word, so keep it their words)</span></span>
              <textarea className="textarea mt-1" rows={2} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Left blank if their site didn't say" />
            </label>
            {offering === "maveriko" && audit && audit.seoScore !== null && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-2 flex gap-1.5">
                <Gauge className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Audited {site.host}: {audit.seoScore}/100 search, {audit.geoScore}/100 AI readiness.
              </p>
            )}
            {offering === "maveriko" && needsAudit && (
              <button className="btn btn-ghost w-full justify-center" onClick={() => research("audit")} disabled={researching}>
                {researching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />} Audit {site.host} for real scores (~20 s)
              </button>
            )}
          </div>
        </div>

        {/* Draft */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div className="text-sm font-semibold">4. Review the email</div>
            {!knowsAnything && (
              <p className="text-xs text-slate-700 bg-slate-50 border border-border-soft rounded-md p-2 flex gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
                This is the general version. Research someone (step 2) or type their details (step 3) to make it personal.
              </p>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted mr-1">Angle</span>
                {ANGLES[offering].map((a) => (
                  <button key={a.id} title={a.hint} onClick={() => pickAngle(a.id)} aria-pressed={activeAngle === a.id}
                    className={`chip ${activeAngle === a.id ? "!border-primary !bg-indigo-50 font-semibold" : ""}`}>
                    {a.label}
                  </button>
                ))}
              </div>
              {activeHint && <p className="text-[11px] text-muted mt-1.5">{activeHint}. Picked to suit their role; change it if you like.</p>}
            </div>

            {edited && (
              <div className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-md p-2 flex items-center gap-2">
                <span className="flex-1">You&apos;ve edited the email, so changes to the facts won&apos;t show up until you rebuild it.</span>
                <button className="btn btn-ghost !py-1 !px-2 text-xs shrink-0"
                  onClick={() => { if (confirm("Rebuild the email from the facts? Your typed changes will be lost.")) setEdited(false); }}>
                  <RotateCcw className="w-3.5 h-3.5" /> Rebuild
                </button>
              </div>
            )}

            <label className="block"><span className="text-xs text-muted">Subject</span>
              <div className="relative mt-1">
                <input className="input pr-10" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} />
                <button type="button" onClick={() => copy("subject")} title="Copy subject" aria-label="Copy subject"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-foreground hover:bg-slate-100">
                  {copied === "subject" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </label>
            <label className="block"><span className="text-xs text-muted">Email</span>
              <textarea className="textarea mt-1 text-[14px] leading-relaxed" rows={18} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
            </label>

            {draft.used.length > 0 && !edited && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Personalised with</span>
                {draft.used.map((u) => <span key={u} className="badge" style={{ background: "#eef2ff", color: "#4338ca" }}>{u}</span>)}
              </div>
            )}
            {draft.warnings.length > 0 && (
              <div className="space-y-1">
                {draft.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}</p>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-3">
            <div className="text-sm font-semibold">5. Send it, copy it, or keep it</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-xs text-muted">Their email <span className="text-slate-400">(only needed to send)</span></span>
                <input className="input mt-1" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="asha@acme.com" />
                {toInvalid && <span className="text-xs text-rose-700 mt-1 block">That doesn&apos;t look like an email address.</span>}
              </label>
              <label className="block"><span className="text-xs text-muted">Send from</span>
                <select className="select mt-1" value={fromMailbox} onChange={(e) => setFromMailbox(e.target.value)} disabled={!mailboxes?.length}>
                  {!mailboxes?.length && (
                    <option value="">{mailboxError ? "Couldn't load mailboxes" : mailboxes ? "No mailbox set up" : "Loading…"}</option>
                  )}
                  {mailboxes?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>
            {mailboxError && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                {mailboxError} If you send now, it will go from the brand&apos;s own mailbox.
              </p>
            )}
            {status?.sundayBlocked && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                It&apos;s Sunday, so sending is switched off. Copy the email or save it, and send it tomorrow.
              </p>
            )}
            {!status?.sundayBlocked && left === 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                You&apos;ve used all {status?.cap} one-off sends for today. Copy it and send tomorrow, or use a campaign.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={() => send()} disabled={busy !== "" || !subject || !body || sendBlocked || toInvalid}
                title={sendBlocked ? "Sending is unavailable right now" : `Send from ${fromLabel}`}>
                {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
              </button>
              <button className="btn btn-ghost" onClick={() => copy("body")} disabled={!body}>
                {copied === "body" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied === "body" ? "Copied" : "Copy email"}
              </button>
              <button className="btn btn-ghost" onClick={saveTemplate} disabled={busy !== "" || !subject || !body}
                title="Save a reusable version for campaigns">
                {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save as template
              </button>
              {left !== null && !status?.sundayBlocked && left > 0 && (
                <span className="text-xs text-muted ml-auto">{left} of {status?.cap} sends left today</span>
              )}
            </div>
            {result && (
              <div className={`text-sm rounded-md p-2 border flex flex-wrap items-center gap-2 ${result.ok ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-rose-800 bg-rose-50 border-rose-200"}`}>
                <span className="flex-1 min-w-[200px]">{result.text}</span>
                {result.link === "templates" && <Link href="/templates" className="underline">Open Mail Templates</Link>}
                {result.sent && <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={startOver}><Eraser className="w-3.5 h-3.5" /> Next person</button>}
              </div>
            )}
            <p className="text-[11px] text-muted">
              Sent as a plain, personal email with no tracking. One-off sends aren&apos;t part of a campaign, so they don&apos;t show in
              campaign stats or automatic reply tracking; replies arrive in the brand mailbox as usual. Every send is
              checked against your unsubscribe list, blocked on Sundays, and capped at {status?.cap ?? 25} a day.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
