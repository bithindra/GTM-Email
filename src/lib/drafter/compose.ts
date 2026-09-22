// Builds a personalised sales email from facts actually found — no AI model, no key.
//
// Every personal sentence is conditional on real data: if we don't know their role, the
// role sentence is dropped rather than filled with a guess or a placeholder. Product claims
// come only from offerings.ts. The result reads like the proven templates because it uses
// their voice, and it cannot invent anything about the prospect.
//
// Pure and dependency-free: runs in the browser so edits re-draft instantly.

import { FACTS, OFFERINGS } from "./offerings";
import type { Company, Draft, DraftAudit, Offering, Person, Role } from "./types";

export type Angle = { id: string; label: string; hint: string };

export const ANGLES: Record<Offering, Angle[]> = {
  brandvibe: [
    { id: "roi", label: "Owner — ROI & cost", hint: "Where AI pays back in their business" },
    { id: "workshop", label: "CXO — hands-on workshop", hint: "Their team builds with AI in the session" },
    { id: "capability", label: "HR / L&D — AI skills", hint: "Practical AI enablement for their people" },
  ],
  maveriko: [
    { id: "audit", label: "Their site's real scores", hint: "Leads with their own audit numbers" },
    { id: "agency", label: "Agency / consultant", hint: "A faster audit tool for their clients" },
  ],
  xambaaz: [
    { id: "pilot", label: "School pilot", hint: "Complimentary pilot + 15-minute call" },
    { id: "exams", label: "Board & entrance prep", hint: "Mock papers with real exam marking" },
  ],
};

const SCHOOL = /\b(school|vidyalaya|vidyalay|vidya|academy|college|junior college|educational|education|institute|shiksha|high school|public school|international school)\b/i;
const AGENCY = /\b(agency|digital marketing|seo|search engine optimi[sz]ation|web design|web development|website design|marketing services|performance marketing|branding studio|creative studio)\b/i;

/** Who is this person, from their headline (and, for schools, the company around them)? */
export function detectRole(person: Pick<Person, "headline" | "about">, company: Pick<Company, "name" | "tagline">): Role {
  const h = person.headline || "";
  const context = `${h} ${company.name} ${company.tagline} ${person.about}`;
  if (/\b(headmaster|headmistress|head of school|head teacher)\b/i.test(h)) return "principal";
  // "Principal" is also a seniority level ("Principal Engineer") — only a school leader
  // when the school context is there.
  if (/\b(principal|vice[- ]principal|correspondent|school director|academic director|trustee)\b/i.test(h) && SCHOOL.test(context)) {
    return "principal";
  }
  if (/\b(chro|hr|human resources?|people (?:ops|operations|officer|partner)|talent|l&d|learning (?:&|and) development|training)\b/i.test(h)) return "hr";
  if (AGENCY.test(context) && /\b(founder|owner|director|partner|ceo|head)\b/i.test(h)) return "agency";
  if (/\b(founder|co-?founder|owner|proprietor|managing director|\bmd\b|chairman|chairperson|managing partner)\b/i.test(h)) return "owner";
  if (/\b(ceo|coo|cmo|cto|cfo|cio|cro|chief|vp|vice president|president|head|director|general manager|\bgm\b)\b/i.test(h)) return "cxo";
  return "other";
}

export function defaultAngle(offering: Offering, role: Role): string {
  if (offering === "maveriko") return role === "agency" ? "agency" : "audit";
  if (offering === "xambaaz") return "pilot";
  if (role === "hr") return "capability";
  if (role === "cxo") return "workshop";
  return "roi";
}

// A headline segment is only used as a job title if it names a role. Slogans ("Helping
// founders scale at speed") are common, and "As Helping founders scale at speed…" is the
// kind of sentence that gives an automated email away.
const ROLE_WORD = /\b(founder|co-?founder|owner|proprietor|ceo|coo|cmo|cto|cfo|cio|cro|chief|president|vp|vice president|director|head|manager|lead|partner|principal|officer|chairman|chairperson|md|gm|consultant|advisor|adviser|architect|engineer|analyst|specialist|executive|trustee|dean|teacher|professor|coordinator|entrepreneur)\b/i;

function headlineSegments(headline: string): string[] {
  return (headline || "").split(/\s+[|·•]\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
}

/** "Founder & CEO at Acme | Speaker" → "Founder & CEO". First segment that names a role; "" if none. */
export function cleanTitle(headline: string): string {
  for (const seg of headlineSegments(headline)) {
    const t = (seg.split(/\s+(?:at|@)\s+/i)[0] ?? "").replace(/[,;:\-–—\s]+$/, "").trim();
    if (t && t.length <= 60 && ROLE_WORD.test(t)) return t;
  }
  return "";
}

/** The employer they state, from the same segment as their title: "CEO at Microsoft | …" → "Microsoft". */
export function employerFrom(headline: string): string {
  for (const seg of headlineSegments(headline)) {
    const m = seg.match(/^(.+?)\s+(?:at|@)\s+([^,;]+)$/i);
    if (!m || !ROLE_WORD.test(m[1])) continue;
    const e = m[2].trim().replace(/[.\s]+$/, "");
    return e.length >= 2 && e.length <= 60 ? e : "";
  }
  return "";
}

const companyKey = (s: string) => s.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|llc|corp|corporation|co|company|group|india)\b/g, "").replace(/[^a-z0-9]/g, "");
/** Loose match: "Acme Dental Pvt Ltd" ≈ "Acme Dental", "Acme" ≈ "Acme Dental Clinic". */
export function sameCompany(a: string, b: string): boolean {
  const x = companyKey(a), y = companyKey(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

/** Their tagline, safe to quote: trailing punctuation stripped so our own sentence closes it. */
function quotable(tagline: string): string {
  return (tagline || "").trim().replace(/[.!?…:;,\s]+$/, "");
}

export type ComposeInput = {
  offering: Offering;
  angle?: string;
  person: Person;
  company: Company;
  audit: DraftAudit | null;
};

export function compose(input: ComposeInput): Draft {
  const { offering, person, company, audit } = input;
  const role = detectRole(person, company);
  const angle = ANGLES[offering].some((a) => a.id === input.angle) ? input.angle! : defaultAngle(offering, role);

  const first = (person.firstName || "").trim();
  const title = cleanTitle(person.headline);
  const companyName = (company.name || person.companyHint || "").trim();
  // Who they say they work for. The role sentence must use THIS — pairing a LinkedIn job
  // title with the website's company would assert a job they may not hold.
  const employer = (employerFrom(person.headline) || person.companyHint || "").trim();
  const mismatch = !!employer && !!company.name && !sameCompany(employer, company.name);
  const host = (company.host || "").trim();
  const tagline = quotable(company.tagline);
  const hasScores = !!audit && audit.seoScore !== null && audit.geoScore !== null;

  const used: string[] = [];
  const warnings: string[] = [];
  if (first) used.push(`First name: ${first}`);

  const greeting = offering === "xambaaz"
    ? (first ? `Dear ${first},` : "Dear Principal,")
    : (first ? `Hi ${first},` : "Hi there,");
  if (!first) warnings.push(`No first name — the greeting says “${offering === "xambaaz" ? "Dear Principal" : "Hi there"}”. Add their name above.`);

  // Sentence about their role — only with both a clean title and a company name.
  const roleLine = (text: (t: string, c: string) => string) => {
    const at = employer || companyName;
    if (!title || !at) return "";
    used.push(`Role: ${title}`, `Company: ${at}`);
    return text(title, at);
  };
  // Sentence showing we looked at their site — only with a real line from it.
  const siteLine = () => {
    if (!tagline || !host) return "";
    used.push(`Homepage line from ${host}`);
    return `I spent a few minutes on ${host} before writing — “${tagline}”.`;
  };
  const withCompany = (a: string, b: string) => (companyName ? a : b);

  let subject = "";
  const paras: string[] = [];

  if (offering === "brandvibe") {
    const f = FACTS.brandvibe;
    if (angle === "workshop") {
      subject = withCompany(`A hands-on AI session for the ${companyName} leadership team`, "A hands-on AI session for your leadership team");
      paras.push(
        roleLine((t, c) => `As ${t} at ${c}, you'll know the hard part isn't buying AI tools — it's getting people to use them on real work.`),
        siteLine(),
        "Most AI workshops end with a slide deck and good intentions. Mine end with your team building working automations on their own use cases — sales, marketing, operations, support — inside the session.",
        "They leave with something running, not another framework to file away.",
        `A little about me: ${f.credentials}.`,
        "Worth a 20-minute call to shape a format around how your team actually works?",
      );
    } else if (angle === "capability") {
      subject = withCompany(`Building real AI skills at ${companyName}`, "Building real AI skills in your teams");
      paras.push(
        roleLine((t, c) => `As ${t} at ${c}, you're probably being asked the question every leadership team is asking: how do we get our people genuinely good with AI?`),
        siteLine(),
        "Most AI training stops at awareness. People nod along, then go back to working the old way.",
        "We run hands-on enablement where each team works on its own processes, so what they build in the room is what they use on Monday. It is practical, measurable, and built around your people rather than a generic syllabus.",
        `A little about me: ${f.credentials}.`,
        "Would a 20-minute call to walk through how this could look for your teams be useful?",
      );
    } else {
      subject = withCompany(`Where AI would actually pay back at ${companyName}`, "Where AI would actually pay back");
      paras.push(
        roleLine((t, c) => `As ${t} at ${c}, you're probably being asked what AI should actually do for the business — not in a deck, but in the numbers.`),
        siteLine(),
        "Most AI pilots never get past the demo. The ones that pay back start from a cost you can already name: proposals that take days, back-office work that runs on copy-paste, the same customer questions answered over and over.",
        `That is the work we do at Brand Vibe. We find the two or three processes where AI removes real cost, then build them and hand them over running, inside your team. ${f.promise}`,
        `A little about me: ${f.credentials}.`,
        `I'd be glad to do ${f.auditOffer}${companyName ? ` for ${companyName}` : ""} — an honest read on where AI would pay back, and where it wouldn't. You can pick a time here: ${f.auditUrl}`,
      );
    }
    if (role === "principal") warnings.push("This looks like a school leader — XamBaaz may be the better fit.");
  }

  if (offering === "maveriko") {
    const f = FACTS.maveriko;
    const where = host || "your site";
    if (angle === "agency") {
      subject = withCompany(`A faster SEO + AI-readiness audit for ${companyName}'s clients`, "A faster SEO + AI-readiness audit for your clients");
      paras.push(
        role === "agency" && companyName ? `Since ${companyName} works on clients' websites, this may save your team a few hours a week.` : "",
        `Maveriko audits any page for SEO and AI readiness in ${f.seconds}: ${f.checks}, two scores, and the exact fix for every check that fails. There's also a competitor gap report against up to three rivals.`,
        `It's free to try with no signup, and Pro is ${f.price} for unlimited scans.`,
        hasScores
          ? `As a quick example, I ran ${where} through it: ${audit!.seoScore}/100 for search and ${audit!.geoScore}/100 for AI readiness.${audit!.reportUrl ? ` Full report: ${audit!.reportUrl}` : ""}`
          : "",
        "Happy to set your team up — just reply.",
      );
      if (role !== "agency") warnings.push("This person doesn't look like an agency or consultant — the “Their site's real scores” angle may land better.");
    } else if (hasScores) {
      subject = `${where} scored ${audit!.seoScore}/100 on search visibility`;
      paras.push(
        `I ran a free check on ${where} and thought the result was worth passing on.`,
        `It scored ${audit!.seoScore}/100 for search visibility and ${audit!.geoScore}/100 for AI readiness — how easily tools like ChatGPT and Google's AI answers can read and quote your site. Most owners have never seen the second number, and it is quietly becoming the one that matters.`,
        audit!.topFix ? `The single biggest fix on your site right now:\n\n${audit!.topFix}` : "",
        audit!.reportUrl ? `The full report is free — no signup, no card:\n${audit!.reportUrl}` : "",
        "That link is yours to keep — pass it to whoever looks after your website. If it's useful and you'd like a hand with the rest, just reply.",
      );
    } else {
      subject = `A free search and AI-readiness check for ${where}`;
      paras.push(
        siteLine(),
        `Maveriko checks any page for search visibility and AI readiness — how easily tools like ChatGPT and Google's AI answers can read and quote it — and shows the exact fix for every check that fails. It takes ${f.seconds} and it's free, with no signup.`,
        `You can run it on ${where} here: ${f.url}`,
        "If the result is useful and you'd like a hand with the fixes, just reply.",
      );
    }
    if (hasScores) used.push(`Audit: ${audit!.seoScore}/100 search, ${audit!.geoScore}/100 AI readiness`);
    else if (angle === "audit") warnings.push("No audit scores — this version offers the free check instead of quoting their real numbers, which is what makes the Maveriko email work.");
  }

  if (offering === "xambaaz") {
    const f = FACTS.xambaaz;
    const pilotLine = "We're offering schools a complimentary pilot, so you can see the impact on your students before any commitment.";
    if (angle === "exams") {
      subject = withCompany(`Board and entrance practice for ${companyName} students`, "Board and entrance practice for your students");
      paras.push(
        roleLine((t, c) => `As ${t} at ${c}, you'll know how much steady practice decides exam results.`),
        f.founder,
        `Students often understand a chapter in class but lose marks under exam pressure. XamBaaz gives them timed, exam-style practice: ${f.boardPapers}, ${f.entrance} with real exam marking, and a step-by-step solution for every question.`,
        "Every chapter also has a free revision page and quizzes at three levels, so students can practise at their own pace.",
        pilotLine,
        "Could we schedule a 15-minute call next week to walk you through it?",
      );
    } else {
      subject = withCompany(`A complimentary XamBaaz pilot for ${companyName}`, "A complimentary XamBaaz pilot for your students");
      paras.push(
        roleLine((t, c) => `As ${t} at ${c}, you'll know how much steady practice decides exam results.`),
        f.founder,
        "I built XamBaaz to give students structured, exam-ready practice that builds on what they learn in class.",
        `XamBaaz turns every NCERT chapter into timed practice for Class 8 to 12 — ${f.questions} across ${f.chapters}, each with a worked explanation, plus ${f.mocks} for CBSE boards, JEE Main, NEET and MHT-CET.`,
        pilotLine,
        "Could we schedule a 15-minute call next week to walk you through it?",
      );
    }
    if (person.headline && role !== "principal") {
      warnings.push("Their headline doesn't read like a school leader — XamBaaz is sold to schools.");
    }
  }

  if (mismatch) {
    warnings.push(`Their LinkedIn says they work at ${employer}, but the website is ${company.name}. Check you have the right person and company before sending.`);
  }

  const body = [greeting, ...paras.filter((p) => p && p.trim()), OFFERINGS[offering].signature].join("\n\n");
  // The company can appear in the subject alone (no role sentence) — still a fact used.
  if (companyName && `${subject}\n${body}`.includes(companyName)) used.push(`Company: ${companyName}`);
  return { subject, body, used: [...new Set(used)], warnings };
}

/**
 * Turn a draft written for one person back into a reusable template: their first name and
 * company become merge fields. Only exact matches are replaced, longest first, so "Acme
 * India" is not half-replaced by "Acme".
 */
export function toTemplate(text: string, person: Pick<Person, "firstName">, companyName: string): string {
  const pairs: [string, string][] = [];
  if (companyName.trim().length >= 2) pairs.push([companyName.trim(), "{{company}}"]);
  if (person.firstName.trim().length >= 2) pairs.push([person.firstName.trim(), "{{first_name}}"]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [from, to] of pairs) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w])${esc}(?![\\w])`, "g"), to);
  }
  return out;
}
