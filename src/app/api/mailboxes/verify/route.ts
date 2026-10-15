import { NextResponse } from "next/server";
import { listMailboxes } from "@/lib/mailboxes";
import { verifyMailbox } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // SMTP handshakes against several hosts

/**
 * Diagnostics: does each configured mailbox actually authenticate?
 *
 * Runs nodemailer's verify() per mailbox — a real SMTP connect + AUTH, but NO mail is
 * sent. This is what proves a newly-added slot is correct: a wrong password surfaces
 * here as `535 authentication failed` rather than as a campaign that silently fails
 * halfway through a list.
 *
 * Deliberately unauthenticated: it sends no mail and returns no credentials — only the
 * address, host and port, all of which recipients see in the headers anyway.
 */
export async function GET() {
  const boxes = listMailboxes();
  const mailboxes = await Promise.all(
    boxes.map(async (m) => {
      const r = await verifyMailbox(m);
      // A mailbox that sends through Amazon SES has two logins to prove: SES (sending)
      // and its own (fallback sending + reading replies and bounces).
      const relay = m.relay ? await verifyMailbox(m.relay) : null;
      return {
        id: m.id, from: m.from, host: m.host, port: m.port, ok: r.ok && (relay?.ok ?? true), ...(r.error ? { error: r.error } : {}),
        ...(m.relay ? { sendsVia: m.relay.name, relayHost: m.relay.host, relayOk: relay!.ok, ...(relay!.error ? { relayError: relay!.error } : {}) } : {}),
      };
    })
  );
  return NextResponse.json({
    count: mailboxes.length,
    allOk: mailboxes.length > 0 && mailboxes.every((m) => m.ok),
    mailboxes,
  });
}
