import { afterEach, describe, expect, it, vi } from "vitest";
import { isPersonal, OPT_OUT_LINE, personalFrom, withOptOut } from "./email";
import { ownWords, wantsOut } from "./inbox";
import { bounceGuardTripped } from "./sender";
import { listMailboxes } from "./mailboxes";

describe("personal notes", () => {
  it("are plain text with tracking off — nothing else", () => {
    expect(isPersonal({ format: "plain", track: false })).toBe(true);
    expect(isPersonal({ format: "plain" })).toBe(true); // plain defaults to tracking off
    expect(isPersonal({ format: "plain", track: true })).toBe(false);
    expect(isPersonal({ format: "rich", track: false })).toBe(false);
  });
  it("come from the person, then the brand", () => {
    expect(personalFrom({ from: "Brand Vibe <hello@brandvibe.co.in>", user: "hello@brandvibe.co.in" }))
      .toBe('"Bithin from Brand Vibe" <hello@brandvibe.co.in>');
    expect(personalFrom({ from: "XamBaaz <partnerships@xambaaz.com>", user: "partnerships@xambaaz.com" }))
      .toBe('"Bithin from XamBaaz" <partnerships@xambaaz.com>');
  });
  it("always carry an opt-out, added only when the copy lacks one", () => {
    expect(withOptOut("Hi there,\n\nBest,\nBithin", true)).toContain(OPT_OUT_LINE);
    const own = 'Hi,\n\nNot useful? Just reply "stop".';
    expect(withOptOut(own, true)).toBe(own);
    expect(withOptOut("Hi", false)).toBe("Hi");
  });
});

describe("a reply that says stop", () => {
  it.each(["stop", "STOP.", "Please remove me from your list", "Not interested, thanks", "unsubscribe", "Don't email me again"])(
    "%s → opt out", (r) => expect(wantsOut(r)).toBe(true),
  );
  it.each([
    "Yes please, send the plan",
    "Can we talk next week? We never stop growing.",
    // Our own P.S. quoted under a real reply must not count as their "stop".
    'Sounds good, call me.\n\nOn Mon, 5 Oct 2026 Bithin wrote:\n> P.S. If this isn\'t for you, just reply "stop"',
  ])("%s → keep", (r) => expect(wantsOut(r)).toBe(false));
  it("drops quoted history", () => {
    expect(ownWords("yes\n> quoted\n>> more")).toBe("yes");
  });
});

describe("SES bounce guard (protects XamBaaz's account)", () => {
  it("waits for 40 sends, then trips above 3%", () => {
    expect(bounceGuardTripped(39, 10)).toBe(false);
    expect(bounceGuardTripped(100, 3)).toBe(false);
    expect(bounceGuardTripped(100, 4)).toBe(true);
  });
});

describe("mailboxes sending through Amazon SES", () => {
  afterEach(() => vi.unstubAllEnvs());
  const slot = () => {
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_USER_4", "hello@brandvibe.co.in");
    vi.stubEnv("SMTP_PASS_4", "x");
    vi.stubEnv("EMAIL_FROM_4", "Brand Vibe <hello@brandvibe.co.in>");
    vi.stubEnv("SMTP_HOST_4", "smtp.hostinger.com");
  };
  it("keep their own address, Reply-To and IMAP, and add SES as the sender", () => {
    slot();
    vi.stubEnv("SEND_VIA_4", "ses");
    vi.stubEnv("SES_SMTP_USER", "AKIAEXAMPLE");
    vi.stubEnv("SES_SMTP_PASS", "secret");
    const m = listMailboxes().find((b) => b.id === "hello@brandvibe.co.in")!;
    expect(m.replyTo).toBe("hello@brandvibe.co.in");
    expect(m.imapHost).toBe("imap.hostinger.com");
    expect(m.relay).toMatchObject({ host: "email-smtp.ap-southeast-2.amazonaws.com", port: 465, user: "AKIAEXAMPLE" });
    expect(m.label).toContain("via Amazon SES");
  });
  it("send directly when SES is asked for but no SES login is set", () => {
    slot();
    vi.stubEnv("SEND_VIA_4", "ses");
    vi.stubEnv("SES_SMTP_USER", "");
    expect(listMailboxes().find((b) => b.id === "hello@brandvibe.co.in")!.relay).toBeNull();
  });
});
