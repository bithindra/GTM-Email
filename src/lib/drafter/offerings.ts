// The ONLY place the drafter gets product facts. Every claim below was checked against
// its source (first 22 Sep 2026, re-checked 5 Oct 2026) — change it here, and re-check the
// source, never in compose.ts.
//
//   Brand Vibe — brandvibe-web/lib/site-config.ts (founder bio, stats, promise line) and
//                app/book-a-growth-audit ("Book a Free Growth Audit", 45 minutes).
//                Clients are deliberately anonymised on the site, so no client names.
//   Maveriko   — webaudit/src/app/llms.txt/route.ts + src/lib/pricing.ts: ~15 s, 38 checks;
//                scores + the top fix are free with no signup (the other fixes need a free
//                sign-in, or Pro); Pro $29/month removes the daily cap; Competitor Gap Report
//                vs up to three competitors. It measures AI READINESS, not whether a site
//                actually gets cited — never claim the latter. No annual plan (disabled).
//   XamBaaz    — live public/llms.txt (49067e5): 30,000+ MCQs each with a worked
//                explanation, 410+ chapters, Easy/Medium/Hard quizzes, a free Key Concepts
//                revision card on 391 chapters (so "most", never "every"), 115 mock papers
//                (32 CBSE board, 21 JEE Main, 21 NEET, 24 MHT-CET) with authentic exam
//                marking and a step-by-step solution for every question, Class 8–12.
//                Plain English; never quote the launch-offer end date in email.

import type { Offering } from "./types";

export type OfferingInfo = {
  id: Offering;
  label: string;
  /** Template category + mailbox match key(s), in preference order. */
  categories: string[];
  blurb: string;
  signature: string;
};

export const OFFERINGS: Record<Offering, OfferingInfo> = {
  brandvibe: {
    id: "brandvibe",
    label: "Brand Vibe",
    categories: ["Brand Vibe"],
    blurb: "AI consulting, hands-on workshops, growth systems",
    signature: "Best,\nBithindra Biswas\nFounder, Brand Vibe Consulting\nbrandvibe.co.in",
  },
  maveriko: {
    id: "maveriko",
    label: "Maveriko",
    // No Maveriko mailbox exists; it is a Brand Vibe product, so it sends from there.
    categories: ["Maveriko", "Brand Vibe"],
    blurb: "Free SEO + AI-readiness audit of their website",
    signature: "Best,\nBithindra Biswas\nMaveriko\nmaveriko.com",
  },
  xambaaz: {
    id: "xambaaz",
    label: "XamBaaz",
    categories: ["XamBaaz"],
    blurb: "Exam practice for schools, Class 8–12",
    signature: "Warm regards,\nBithindra Biswas\nFounder, XamBaaz\nxambaaz.com",
  },
};

export const FACTS = {
  brandvibe: {
    promise: "We don't sell AI strategy decks — we ship working AI systems, live in weeks, not quarters.",
    credentials:
      "IIM Ahmedabad, 20+ years running businesses across media, telecom, banking and technology, guest faculty at IIM Mumbai and IIT Bombay, and a LinkedIn Top Voice",
    auditOffer: "a free 45-minute growth audit",
    auditUrl: "https://brandvibe.co.in/book-a-growth-audit",
  },
  maveriko: {
    url: "https://maveriko.com",
    seconds: "about 15 seconds",
    checks: "38 checks",
    price: "$29 a month",
    freeTier: "Your scores and the single biggest fix are free, with no signup",
    pro: "Pro, at $29 a month, removes the daily cap and unlocks every fix",
    compare: "a competitor gap report against up to three rivals",
  },
  xambaaz: {
    founder: "I'm Bithindra Biswas, an IIM Ahmedabad alumnus and guest faculty at IIT Bombay.",
    questions: "30,000+ questions",
    chapters: "410+ chapters",
    mocks: "115 full-length mock papers",
    boardPapers: "32 CBSE-pattern board papers",
    entrance: "21 JEE Main and 21 NEET papers",
    marking: "real exam marking",
    solutions: "a step-by-step solution for every question",
    revision: "Most chapters also have a free Key Concepts revision page, and every chapter has timed quizzes at three levels — Easy, Medium and Hard",
  },
} as const;

/**
 * Phrases that must never reach a prospect: unverified or banned claims, and any sign
 * of a template leaking through. Enforced by compose.test.ts across every offering × angle.
 */
export const BANNED = [
  "cited by", // Maveriko measures readiness, never actual AI citation
  "ai visibility",
  "1 december", // XamBaaz launch-offer date: /pricing, /terms, /refund only
  "nmims", // not on the Brand Vibe site
  "sr vp", // title not stated on the site
  "{{",
  "}}",
  "undefined",
  "null",
  "[object",
];
