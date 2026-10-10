"use client";

import { useEffect } from "react";

// Catch-up dispatch when GTM Flow is opened. The Vercel crons (vercel.json) are the
// primary trigger and cover the send window; this only fires on app open, and at most
// once every 2 hours per browser, so a tab left open (or re-focused all day) no longer
// wakes Neon every 15 minutes. "Send now" / "Run follow-ups" on a campaign remain the
// way to force a send — they don't go through here.
const KEY = "gtm:lastAutoDispatch";
const MIN_GAP_MS = 2 * 60 * 60 * 1000;

export default function AutoDispatch() {
  useEffect(() => {
    let last = 0;
    try { last = Number(localStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last < MIN_GAP_MS) return;
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
    fetch("/api/dispatch/tick").catch(() => {});
  }, []);
  return null;
}
