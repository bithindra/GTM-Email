import { describe, expect, it } from "vitest";
import { processFollowups, sendCampaignQueued } from "./sender";
import type { Store } from "./db";

// A store where anything not stubbed throws, so a test fails if the sender touches it.
const fakeStore = (stubs: Partial<Record<keyof Store, unknown>>) =>
  new Proxy({} as Store, {
    get: (_t, k: string) => (k in stubs ? stubs[k as keyof Store] : () => { throw new Error(`unexpected ${k}()`); }),
  });

describe("Neon trims — skip heavy reads when nothing can be sent", () => {
  it("follow-up pass with nothing due reads no templates, suppressions or prospects", async () => {
    const r = await processFollowups(fakeStore({ dueFollowups: async () => [] }), 100);
    expect(r).toMatchObject({ due: 0, sent: 0, budgetLeft: 100 });
  });

  it("a campaign held back by the daily cap never loads its attachment blob", async () => {
    let rescheduled = false;
    const store = fakeStore({
      getCampaign: async () => ({ id: "c1", templateId: "t1", fromMailbox: null, scheduledAt: "2026-10-01T00:00:00Z" }),
      getTemplate: async () => ({ id: "t1", subject: "s", body: "b" }),
      setCampaignStatus: async () => {},
      claimCampaign: async () => true,
      getRecipients: async () => [{ id: "r1", prospectId: "p1", email: "a@example.com", status: "queued" }],
      getProspectsByIds: async () => [{ id: "p1", emailStatus: "verified" }],
      getAuditsByWebsites: async () => new Map(),
      suppressedEmails: async () => new Set<string>(),
      rescheduleCampaign: async () => { rescheduled = true; },
      // getCampaignAttachments deliberately absent → throws if called
    });
    const r = await sendCampaignQueued(store, "c1", 0);
    expect(r).toMatchObject({ sent: 0, throttled: 1, budgetLeft: 0 });
    expect(rescheduled).toBe(true);
  });

  it("a campaign another run is already sending is left alone", async () => {
    const store = fakeStore({
      getCampaign: async () => ({ id: "c1", templateId: "t1", fromMailbox: null }),
      getTemplate: async () => ({ id: "t1", subject: "s", body: "b" }),
      claimCampaign: async () => false,
      // getRecipients absent → throws if the run went on to read the queue
    });
    const r = await sendCampaignQueued(store, "c1", 50);
    expect(r).toMatchObject({ sent: 0, budgetLeft: 50 });
  });
});
