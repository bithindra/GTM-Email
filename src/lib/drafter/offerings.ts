// The ONLY place the drafter gets product facts. Every claim below was checked against
// its source on 22 Sep 2026 — change it here, and re-check the source, never in compose.ts.
//
//   Brand Vibe — brandvibe-web/lib/site-config.ts (founder bio, stats, promise line) and
//                app/book-a-growth-audit ("Book a Free Growth Audit", 45 minutes).
//                Clients are deliberately anonymised on the site, so no client names.
//   Maveriko   — webaudit/src/app/llms.txt/route.ts + src/lib/pricing.ts: free, no signup,
//                ~15 s, 38 checks, Pro $29/month. It measures AI READINESS, not whether a
//                site actually gets cited — never claim the latter. No annual plan (disabled).
//   XamBaaz    — live public/llms.txt (be30187): 30,000+ MCQs, 410+ chapters, 115 mock
//                papers (32 CBSE board, 21 JEE Main, 21 NEET, 24 MHT-CET), Class 8–12.
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
    signature: "Warm regards,\nBithindra Biswas\nFounder, XamBaaz\nwww.xambaaz.com",
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
  },
  xambaaz: {
    founder: "I'm Bithindra Biswas, an IIM Ahmedabad alumnus and guest faculty at IIT Bombay.",
    questions: "30,000+ questions",
    chapters: "410+ chapters",
    mocks: "115 full-length mock papers",
    boardPapers: "32 CBSE-pattern board papers",
    entrance: "21 JEE Main and 21 NEET papers",
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
