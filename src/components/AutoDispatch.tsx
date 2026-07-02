"use client";

import { useEffect } from "react";

// Fires the dispatcher whenever GTM Flow is open — on mount, every 15 minutes
// while a tab stays open, and again when the tab regains focus. The GitHub Action
// (every 30 min in business hours) is the primary trigger; this is a backup so
// scheduled sends still fire promptly when the app happens to be open.
export default function AutoDispatch() {
  useEffect(() => {
    const tick = () => fetch("/api/dispatch/tick").catch(() => {});
    tick();
    const interval = setInterval(tick, 15 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
