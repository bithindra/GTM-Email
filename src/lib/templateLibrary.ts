// Starter mail library — the ready-to-send mails that ship with the app, grouped by
// category (offer/audience). This is the single source of truth for three consumers:
//   1. PgStore.init()      — seeds them once into Postgres (marker-guarded)
//   2. MemoryStore.seed()  — seeds them for the no-DATABASE_URL dev/demo mode
//   3. /api/templates/library — lets the UI add another copy of any preset later
//
// Every preset is `plain` format: no heavy styling, reads hand-typed — the best body
// shape for landing in the Primary tab. Tracking is ON, because the open pixel is the
// only thing that records an open; with it off the dashboard reports 0% opens no matter
// how well the mail actually lands, which makes a subject-line problem indistinguishable
// from a deliverability problem. These mails carry no links, so enabling tracking adds
// the pixel only — no link rewriting, which is the larger spam signal of the two.
// Bodies use {{merge_fields}} and {a|b} spintax so no two recipients get identical mail.

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
  /* ---------------- AI Consulting → business owners ---------------- */
  {
    key: "ai-consulting-margins",
    name: "Owners — Cost & margin",
    category: "AI Consulting",
    subject: "{A thought|An idea} on {{company}}'s margins",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

{Short note|Quick note} — I work with mid-size businesses on where AI actually removes cost, not where it looks impressive.

In most operations the money sits in three places: quotes and proposals that take days, back-office work that runs on copy-paste, and support that answers the same twenty questions. We rebuild those, hands-on, inside your team.

Background: IIM Ahmedabad alumnus, {professor at IIT Bombay|IIT Bombay professor}, and I've run this inside {several|a number of} businesses your size.

Worth 15 minutes to look at where {{company}}'s margin is leaking? If it isn't a fit, a one-line no is a perfectly good answer.

Best,
Bithindra`,
  },
  {
    key: "ai-consulting-throughput",
    name: "Owners — Growth & throughput",
    category: "AI Consulting",
    subject: "{{first_name}}, {doing more|more output} with the same team",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

{A question|One question}, owner to owner: if {{company}} could take on 30% more work without adding headcount, what would you do with it?

That's usually what AI is good for in a business your size — not replacing people, but taking the repetitive half of everyone's day off their plate so the same team handles more.

I'm an IIM Ahmedabad alumnus and a professor at IIT Bombay, and I do this hands-on with mid-size companies: we pick two or three real processes and rebuild them together over a few weeks.

{Open to a short call|Worth a 15-min call} to map yours?

Best,
Bithindra`,
  },

  /* ---------------- AI Workshop → CXOs ---------------- */
  {
    key: "ai-workshop-handson",
    name: "CXO — Hands-on team workshop",
    category: "AI Workshop",
    subject: "{Hands-on AI|A working session} for your leadership team",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

Most AI sessions leave a leadership team with slides and no new capability. Mine don't — it's a working day where your team builds with the tools on your own processes and walks out with something running.

The shape of the day: two hours on what the technology genuinely does and doesn't do, then the rest spent building — a drafting workflow, an analysis assistant, a reporting job — using {{company}}'s real work as the material.

I'm an IIM Ahmedabad alumnus and a professor at IIT Bombay, and I've run this for {several|a number of} mid-size leadership teams.

{Shall I send the one-page outline|Want the one-page outline}?

Best,
Bithindra`,
  },
  {
    key: "ai-workshop-gap",
    name: "CXO — Capability gap",
    category: "AI Workshop",
    subject: "{{first_name}}, the AI gap {isn't|is not} tooling",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

{Something I keep seeing|A pattern I keep seeing}: a company buys the licences, and six months later almost nobody's daily work has changed. The gap isn't the tooling — it's that no one was shown how to apply it to their own job.

That's fixable in a day. I run hands-on sessions where your leaders and their teams build on {{company}}'s actual processes, so what they make on the day is what they keep using on Monday.

IIM Ahmedabad alumnus, professor at IIT Bombay, and a lot of time spent inside mid-size businesses making this stick.

{Worth a conversation|Open to a short call}?

Best,
Bithindra`,
  },

  /* ---------------- XamBaaz → school principals ---------------- */
  {
    key: "xambaaz-outcomes",
    name: "Principals — Exam outcomes",
    category: "XamBaaz",
    subject: "{A question|Quick question} on {{company}}'s board results",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

{A quick question|One question} about how {{company}} prepares students for the boards — how do your teachers currently see which chapters a class is weakest in, before the exam rather than after?

That's what we built XamBaaz for: chapter-wise practice mapped to the NCERT syllabus, students practise on their own, and teachers get a simple view of where each section is struggling.

It sits alongside whatever you already use — nothing changes in your timetable.

{Happy to show you|I can walk you through it} in 15 minutes, or send a link your academic head can try.

Best,
Bithindra`,
  },
  {
    key: "xambaaz-pilot",
    name: "Principals — No-cost pilot",
    category: "XamBaaz",
    subject: "{{first_name}}, a {no-cost|zero-cost} pilot for one section",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

Rather than make the case in an email, here's an easier way to judge XamBaaz: run it with one section for one term, at no cost.

Your students get chapter-wise practice on the NCERT syllabus. Your teachers get a weekly view of where that section is weak. At the end of the term you compare that section's results against the others and decide for yourself.

No commitment either way, and nothing changes in your timetable.

{Shall I set one up|Want me to set one up} for {{company}}?

Best,
Bithindra`,
  },

  /* ---------------- General → rename and reuse for anything else ---------------- */
  {
    key: "general-cold-intro",
    name: "General — Cold intro (edit me)",
    category: "General",
    subject: "{Quick|A quick} thought for {{company}}",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

{Quick note|A quick note} — I'll keep it short.

[one specific, relevant line about {{company}}]

[the single thing you do for them, in one sentence]

{Worth a quick chat|Open to a 15-min call} to see if it's a fit? If not, a one-line no is a perfectly good answer.

Best,
Bithindra`,
  },
  {
    key: "general-followup",
    name: "General — Follow-up / bump (edit me)",
    category: "General",
    subject: "Re: {{company}}",
    format: "plain",
    track: true,
    body: `Hi {{first_name}},

{Floating this back to the top of your inbox|Bringing this back up} in case it got buried.

{Still happy to|Happy to} share the details whenever it's useful — and if the timing is wrong, just say so and I'll leave it there.

Best,
Bithindra`,
  },
];
