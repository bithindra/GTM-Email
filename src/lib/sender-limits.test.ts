import { describe, expect, it } from "vitest";
import { MAILBOX_LIMIT_ERROR } from "./sender";

describe("MAILBOX_LIMIT_ERROR — stop at the first 'mailbox is out of quota' reply", () => {
  it.each([
    // Real Hostinger reply, 5 Oct 2026: the app kept trying all 26 because this didn't match.
    'Message failed: 451 4.7.1 Ratelimit "hostinger_out_ratelimit" exceeded for key "RLknzmz64phw36f6y7jd77aaft"',
    "550 5.4.5 Daily user sending quota exceeded",
    "421 4.7.0 Rate limit exceeded",
    "Too many messages sent from this account",
  ])("%s", (err) => expect(MAILBOX_LIMIT_ERROR.test(err)).toBe(true));
  it("does not treat a bad address as a mailbox limit", () => {
    expect(MAILBOX_LIMIT_ERROR.test("550 5.1.1 The email account that you tried to reach does not exist")).toBe(false);
  });
});
