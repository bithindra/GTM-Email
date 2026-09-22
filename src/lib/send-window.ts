// The human-hours guard for the AUTO dispatcher, kept free of mail/DB imports so
// the campaign form can share the timezone list and tests can run it alone.
//
// Real people don't get cold email at 3am (or on a Sunday), and providers weight
// send time into spam scoring. Defaults to Mon–Sat, 9:00–20:00 in the HOME zone
// (SEND_WINDOW_TZ, default Asia/Kolkata); set SEND_WINDOW_START=0
// SEND_WINDOW_END=24 and SEND_ON_SUNDAY=1 to disable both. Manual "Send now"
// bypasses this (it calls sendCampaignQueued directly).
//
// A campaign can carry its own `sendTz` (the recipients' zone). Hours are then
// judged in that zone, so a Singapore list goes out in Singapore office hours.
// Sunday is blocked on BOTH sides — the recipient's Sunday and the home Sunday —
// so the standing "never send on Sunday" rule holds whichever zone is chosen.

/** The zones a campaign may target. One list for the form and the API. */
export const SEND_TIMEZONES = [
  { id: "Asia/Kolkata", label: "India (IST)" },
  { id: "Asia/Singapore", label: "Singapore (SGT)" },
  { id: "America/New_York", label: "US Eastern (ET)" },
  { id: "America/Los_Angeles", label: "US Pacific (PT)" },
] as const;

export type SendTz = (typeof SEND_TIMEZONES)[number]["id"];

export const isSendTz = (v: unknown): v is SendTz =>
  typeof v === "string" && SEND_TIMEZONES.some((z) => z.id === v);

export const homeTz = () => process.env.SEND_WINDOW_TZ || "Asia/Kolkata";

const weekday = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
const hourIn = (now: Date, timeZone: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now)) % 24;

/**
 * Is `now` inside the send window for a campaign in zone `tz`? `null`/omitted =
 * the home zone, which is exactly the behaviour before per-campaign zones.
 * An unknown zone holds the send (fails shut) rather than guess the hour.
 */
export function withinSendWindow(now: Date = new Date(), tz?: string | null): boolean {
  const home = homeTz();
  const zone = tz || home;
  try {
    if (process.env.SEND_ON_SUNDAY !== "1") {
      if (weekday(now, zone) === "Sun" || weekday(now, home) === "Sun") return false;
    }
    const start = Number(process.env.SEND_WINDOW_START ?? 9);
    const end = Number(process.env.SEND_WINDOW_END ?? 20);
    if (start <= 0 && end >= 24) return true;
    const h = hourIn(now, zone);
    return h >= start && h < end;
  } catch (e) {
    console.warn(`[send-window] unusable timezone "${zone}" — holding sends`, e);
    return false;
  }
}

/**
 * The standing "never send on Sunday" rule on its own, without the hours check —
 * for one-off manual sends (the email drafter), where the hour is the sender's call
 * but Sunday still is not. Honours SEND_ON_SUNDAY=1 like the window does.
 */
export function isBlockedSunday(now: Date = new Date(), tz?: string | null): boolean {
  if (process.env.SEND_ON_SUNDAY === "1") return false;
  const home = homeTz();
  try {
    return weekday(now, home) === "Sun" || (!!tz && weekday(now, tz) === "Sun");
  } catch {
    return true; // unusable zone: fail shut, as the window does
  }
}

/** True if ANY zone a campaign could use is open — lets the dispatcher skip its queries at night. */
export const anySendWindowOpen = (now: Date = new Date()) =>
  [homeTz(), ...SEND_TIMEZONES.map((z) => z.id)].some((z) => withinSendWindow(now, z));
