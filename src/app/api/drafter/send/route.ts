import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getStore } from "@/lib/db";
import { renderBodyHtml, sendEmail } from "@/lib/email";
import { validateAddress } from "@/lib/emailcheck";
import { listMailboxes } from "@/lib/mailboxes";
import { mailboxForCategories } from "@/lib/mailbox-match";
import { homeTz, isBlockedSunday } from "@/lib/send-window";
import { normalizeWebsite } from "@/lib/audit";
import { OFFERINGS } from "@/lib/drafter/offerings";
import type { Offering } from "@/lib/drafter/types";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The app has no login, so this is a public "send one email" endpoint. It is only
// ever meant for hand-written one-offs, so it is capped hard: a day's worth of real
// 1:1 outreach, and nowhere near enough to be worth abusing.
const DAILY_CAP = 25;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: homeTz() }).format(new Date());
const dayKey = () => `drafter_sends:${today()}`;
const sentKey = (to: string) => `drafter_to:${to}`;

/** "Asha Rao <asha@acme.com>" or "mailto:asha@acme.com" → "asha@acme.com". */
function bareAddress(raw: unknown): string {
  const s = String(raw || "").trim();
  const inAngles = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (inAngles ? inAngles[1] : s).replace(/^mailto:/i, "").trim().toLowerCase();
}

/** What the page shows before anyone presses Send: today's usage and the Sunday block. */
export async function GET() {
  try {
    const sentToday = await getStore().readCounter(dayKey());
    return NextResponse.json({ sentToday, cap: DAILY_CAP, sundayBlocked: isBlockedSunday() });
  } catch {
    return NextResponse.json({ error: "Couldn't read today's send count." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  // Same-origin only: the drafter page always sends Origin; a cross-site form or a
  // casual script does not match. Not authentication — a speed bump, with the cap behind it.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!origin || !host) return NextResponse.json({ error: "Send from the Email Drafter page." }, { status: 403 });
  try {
    if (new URL(origin).host !== host) return NextResponse.json({ error: "Send from the Email Drafter page." }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Send from the Email Drafter page." }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const offering = b.offering as Offering;
  if (!OFFERINGS[offering]) return NextResponse.json({ error: "Unknown offering." }, { status: 400 });
  const to = bareAddress(b.to);
  const subject = String(b.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const body = String(b.body || "").trim().slice(0, 20_000);
  if (!subject || !body) return NextResponse.json({ error: "The email needs a subject and a body." }, { status: 400 });

  // 1. A real, deliverable address.
  const verdict = await validateAddress(to);
  if (verdict !== "valid") {
    return NextResponse.json({ error: verdict === "no_mx" ? "That email's domain can't receive mail." : "That isn't a valid email address." }, { status: 400 });
  }

  // 2. Never mail someone who unsubscribed or hard-bounced.
  const store = getStore();
  if ((await store.suppressedEmails()).has(to)) {
    return NextResponse.json({ error: "This person unsubscribed or bounced before — not sending." }, { status: 409 });
  }

  // 3. The standing rule: never send on a Sunday.
  if (isBlockedSunday()) return NextResponse.json({ error: "It's Sunday — sends are blocked. Copy it and send tomorrow." }, { status: 409 });

  // 4. A second email to the same person is usually a double-click or a forgotten
  //    earlier send. Ask first; the page re-sends with `again: true` once confirmed.
  if (!b.again && (await store.readCounter(sentKey(to))) > 0) {
    return NextResponse.json({ code: "already_sent", error: `You've already emailed ${to} from the drafter.` }, { status: 409 });
  }

  // 5. Daily cap, counted per home-zone day. Counted before sending, so a failed send
  //    still uses a slot — the conservative side of the trade.
  const used = await store.incrementCounter(dayKey());
  if (used > DAILY_CAP) {
    return NextResponse.json({ error: `Daily limit of ${DAILY_CAP} drafter sends reached — copy it and send tomorrow, or use a campaign.` }, { status: 429 });
  }

  // 6. Sender: the one chosen, if it is a real configured mailbox; else the brand's own.
  const boxes = listMailboxes();
  const chosen = boxes.find((m) => m.id === String(b.mailboxId || "").toLowerCase())?.id
    ?? mailboxForCategories(OFFERINGS[offering].categories, boxes)
    ?? boxes[0]?.id
    ?? null;

  // Plain format, no tracking pixel: a one-to-one note should look like one.
  const html = renderBodyHtml("plain", false, body, "");
  const res = await sendEmail({ to, subject, html, text: body, mailboxId: chosen });
  if (!res.ok) return NextResponse.json({ error: `The mail server refused it: ${res.error}` }, { status: 502 });
  if (!res.simulated) await store.incrementCounter(sentKey(to)).catch(() => {});

  // Remember the person, so a future campaign dedupes against them. Best-effort.
  try {
    const p = (b.person ?? {}) as { name?: string; headline?: string };
    const c = (b.company ?? {}) as { name?: string; website?: string };
    const prospect: Prospect = {
      id: uuid(),
      name: String(p.name || "").slice(0, 120),
      title: String(p.headline || "").slice(0, 200),
      company: String(c.name || "").slice(0, 120),
      companySize: "", industry: "", country: "", city: "",
      linkedin: String(b.linkedinUrl || "").slice(0, 300),
      email: to,
      emailStatus: "verified",
      website: normalizeWebsite(String(c.website || "")) || undefined,
      createdAt: new Date().toISOString(),
    };
    await store.saveProspects([prospect]);
  } catch { /* the send already succeeded; saving the contact is a nice-to-have */ }

  return NextResponse.json({ ok: true, simulated: res.simulated, from: chosen, sentToday: used, cap: DAILY_CAP });
}
