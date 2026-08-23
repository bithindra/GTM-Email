// The canonical mail library — the three mails the outreach actually runs on, grouped
// by brand. Consumed by:
//   1. PgStore.init()      — seeds them once into Postgres (marker-guarded)
//   2. MemoryStore.seed()  — seeds them for the no-DATABASE_URL dev/demo mode
//   3. /api/templates/library — the in-app "Library" panel, so a mail that gets edited
//      beyond repair or deleted can be restored to this known-good version
//
// Kept deliberately small. Two of these three have real send history behind them
// (AI Workshop: 1,314 sent / 42% open; Principal Intro: 1,260 sent / 39% open), so the
// copy here is proven, not speculative — edit it rather than replacing it wholesale.
// Format is `rich` with tracking ON: the open pixel is the only thing that records an
// open, and these are the settings the 42%/39% numbers were measured under.
//
// To write a mail from scratch instead, use "New mail" in the Templates page — that
// gives a blank scaffold and never touches this file.

export type LibraryTemplate = {
  key: string; // stable id for this preset — never reused, never renamed
  name: string;
  category: string;
  subject: string;
  body: string;
  format: "plain" | "rich" | "newsletter";
  track: boolean;
};

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  /* ---------------- Brand Vibe ---------------- */
  {
    key: "brandvibe-ai-workshop",
    name: "Brand Vibe — AI Workshop",
    category: "Brand Vibe",
    subject: "A hands-on AI workshop for your leadership team",
    format: "rich",
    track: true,
    body: `Hi {{first_name}},

Most AI workshops end with a slide deck and good intentions. Mine end with your team shipping live automations before lunch.

I run a hands-on AI workshop designed to make teams AI-native—not "AI-aware." Your people work on their own real use cases (sales, marketing, ops, support) inside the session, and walk out having built and deployed working automations, not another framework to file away.

Recent proof: took a B2B leadership team from zero to two live AI automations in one week, covering lead qualification and internal reporting.

Why me: 20+ years running P&Ls across media, telecom, banking, and tech (Sr VP, Radio Mirchi; roles at Idea Cellular, ICICI Bank, IBM). MBA from IIM Ahmedabad. Currently Guest Faculty at IIT Bombay and IIM Mumbai/NMIMS, teaching AI & strategy.

I don't teach AI as theory—I embed it as a working system your team owns by the end of the session.

Worth a 20-minute call to scope a workshop format that fits your team's real workflows?

Best,
Bithindra Biswas
IIM Ahmedabad Alumnus | LinkedIn Top Voice
brandvibe.co.in/ai-services`,
  },
  {
    key: "brandvibe-owners-roi",
    name: "Brand Vibe — Owners ROI",
    category: "Brand Vibe",
    subject: "The ROI question on AI, for {{company}}",
    format: "rich",
    track: true,
    body: `Hi {{first_name}},

Most AI pilots never get past the demo. The ones that pay back start from a cost you can already name.

I work with owners to find the two or three processes where AI removes real cost — quotes and proposals that take days, back-office work running on copy-paste, support answering the same twenty questions — and we rebuild them inside your team, not in a consultant's deck.

Recent proof: a B2B leadership team went from zero to two live automations in one week, covering lead qualification and internal reporting, with the hours saved showing up the same month.

Why me: 20+ years running P&Ls across media, telecom, banking, and tech (Sr VP, Radio Mirchi; roles at Idea Cellular, ICICI Bank, IBM). MBA from IIM Ahmedabad. Currently Guest Faculty at IIT Bombay and IIM Mumbai/NMIMS, teaching AI & strategy.

If the payback isn't there, I'll tell you upfront — better to know before a pilot than after one.

Worth 20 minutes to put real numbers against one process at {{company}}?

Best,
Bithindra Biswas
IIM Ahmedabad Alumnus | LinkedIn Top Voice
brandvibe.co.in/ai-services`,
  },

  /* ---------------- XamBaaz ---------------- */
  {
    key: "xambaaz-principal-intro",
    name: "XamBaaz — Principal Intro",
    category: "XamBaaz",
    subject: "A complimentary XamBaaz pilot for your students",
    format: "rich",
    track: true,
    body: `Dear Principal,

I'm Bithindra Biswas, an IIM Ahmedabad alumnus and faculty at IIT Bombay, with over 20 years of experience across classrooms and education leadership.

I built XamBaaz.com to solve a simple gap: students need structured, exam-ready practice that also reinforces what they learn in school. XamBaaz is a mobile-first, AI-driven platform that turns every NCERT chapter into practice for Boards, JEE Main, and NEET, with real negative marking and chapter-wise analytics. We are live with 18,000+ questions across 315 chapters for Classes 8-12.

We are currently offering schools a complimentary pilot.

This gives your school:

Better monitoring of logged-in student performance.

Stronger retention of school learning through continuous practice.

Early preparation for future entrance exams like JEE and NEET.

A no-risk way to evaluate impact before any commitment.

Could we schedule a 15-minute call next week to walk you through it?

Warm regards,
Bithindra Biswas
Founder & CEO, XamBaaz
xambaaz.com | linkedin.com/in/bithin`,
  },

  /* ---------------- Maveriko ---------------- */
  // The audit-outreach mail. Every {{audit field}} is backed by a real Maveriko
  // scan of that recipient's own site, run before the campaign is created — the
  // sender REFUSES to send this template to anyone without one (see
  // hasUnresolvedMerge in email.ts), so it can never go out with blanks.
  //
  // Written for a generic inbox: Maps-scraped addresses are overwhelmingly
  // info@/contact@, so {{first_name}} resolves to "there" and the copy has to
  // read naturally that way.
  {
    key: "maveriko-audit-intro",
    name: "Maveriko — Free Site Audit",
    category: "Maveriko",
    subject: "{{website}} scored {{seo_score}}/100 on search visibility",
    format: "rich",
    track: true,
    body: `Hi {{first_name}},

I ran a free check on {{website}} this week and thought the result was worth passing on.

It scored {{seo_score}}/100 for search visibility and {{geo_score}}/100 for AI readiness — how easily tools like ChatGPT and Google's AI answers can find and quote your business. The AI number is the one most owners have never seen, and it is quietly becoming the one that matters: people increasingly ask an assistant for a recommendation instead of scrolling results.

The single biggest fix on your site right now:

{{top_fix}}

Full report, free, no signup and no card:
{{report_url}}

That link is yours to keep — pass it to whoever looks after your website. If it's useful and you'd like a hand working through the rest, just reply.

Best,
Bithindra Biswas
Maveriko
maveriko.com`,
  },
];
