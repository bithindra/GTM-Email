import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEND_TIMEZONES, anySendWindowOpen, isSendTz, withinSendWindow } from "./send-window";

// Fixed instants, all in UTC. Sep 2026: US on daylight time (ET = UTC-4, PT = UTC-7).
const at = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.stubEnv("SEND_WINDOW_TZ", "Asia/Kolkata");
  vi.stubEnv("SEND_WINDOW_START", "9");
  vi.stubEnv("SEND_WINDOW_END", "20");
  vi.stubEnv("SEND_ON_SUNDAY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("withinSendWindow — per-campaign zone", () => {
  it("Monday 10:00 SGT is open for Singapore and shut for US Eastern (Sunday night there)", () => {
    const t = at("2026-09-21T02:00:00Z"); // Mon 10:00 SGT · Mon 07:30 IST · Sun 22:00 ET
    expect(withinSendWindow(t, "Asia/Singapore")).toBe(true);
    expect(withinSendWindow(t, "America/New_York")).toBe(false);
    expect(withinSendWindow(t, null)).toBe(false); // 07:30 IST, before the home window
  });

  it("holds Sunday in the recipient's zone", () => {
    expect(withinSendWindow(at("2026-09-20T03:00:00Z"), "Asia/Singapore")).toBe(false); // Sun 11:00 SGT
  });

  it("holds when it is Sunday at home even though it is a Saturday afternoon in the US", () => {
    // Sat 15:00 ET is inside US hours; only the home-Sunday rule (Sun 00:30 IST) stops it.
    expect(withinSendWindow(at("2026-09-19T19:00:00Z"), "America/New_York")).toBe(false);
  });

  it("SEND_ON_SUNDAY=1 lifts both Sunday checks", () => {
    vi.stubEnv("SEND_ON_SUNDAY", "1");
    expect(withinSendWindow(at("2026-09-19T19:00:00Z"), "America/New_York")).toBe(true);
  });

  it("null zone behaves exactly as the old home-only guard", () => {
    expect(withinSendWindow(at("2026-09-21T04:00:00Z"), null)).toBe(true); // Mon 09:30 IST
    expect(withinSendWindow(at("2026-09-21T14:30:00Z"), null)).toBe(false); // Mon 20:00 IST — end is exclusive
    expect(withinSendWindow(at("2026-09-21T04:00:00Z"))).toBe(withinSendWindow(at("2026-09-21T04:00:00Z"), "Asia/Kolkata"));
  });

  it("fails shut on an unknown zone instead of guessing the hour", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(withinSendWindow(at("2026-09-21T04:00:00Z"), "Mars/Olympus_Mons")).toBe(false);
  });
});

describe("the two daily crons reach the right campaigns", () => {
  // Hobby fires anywhere in the hour, so check both ends of each hour.
  for (const iso of ["2026-09-21T09:00:00Z", "2026-09-21T09:59:00Z"]) {
    it(`0 9 UTC (${iso.slice(11, 16)}) sends India + Singapore, not the US`, () => {
      const t = at(iso);
      expect(withinSendWindow(t, "Asia/Kolkata")).toBe(true);
      expect(withinSendWindow(t, "Asia/Singapore")).toBe(true);
      expect(withinSendWindow(t, "America/New_York")).toBe(false);
      expect(withinSendWindow(t, "America/Los_Angeles")).toBe(false);
    });
  }
  for (const iso of ["2026-09-21T17:00:00Z", "2026-09-21T17:59:00Z", "2026-12-07T17:00:00Z", "2026-12-07T17:59:00Z"]) {
    it(`0 17 UTC (${iso.slice(0, 16)}) sends the US only`, () => {
      const t = at(iso);
      expect(withinSendWindow(t, "America/New_York")).toBe(true);
      expect(withinSendWindow(t, "America/Los_Angeles")).toBe(true); // 09:00 PST at the earliest
      expect(withinSendWindow(t, "Asia/Kolkata")).toBe(false);
      expect(withinSendWindow(t, "Asia/Singapore")).toBe(false);
    });
  }
});

describe("zone list", () => {
  it("every listed zone is a real IANA zone", () => {
    for (const z of SEND_TIMEZONES) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z.id })).not.toThrow();
  });
  it("isSendTz accepts only listed zones", () => {
    expect(isSendTz("Asia/Singapore")).toBe(true);
    expect(isSendTz("Europe/London")).toBe(false);
    expect(isSendTz(42)).toBe(false);
  });
  it("anySendWindowOpen is false when every zone is shut", () => {
    // Sun 03:00 UTC: Sunday in India and Singapore; Sat night in the US but Sunday at home.
    expect(anySendWindowOpen(at("2026-09-20T03:00:00Z"))).toBe(false);
    expect(anySendWindowOpen(at("2026-09-21T09:30:00Z"))).toBe(true);
  });
});
