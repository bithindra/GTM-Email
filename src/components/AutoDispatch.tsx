"use client";

import { useEffect } from "react";

// Fires the dispatcher whenever GTM Flow is open — on mount, every 5 minutes
// while a tab stays open, and again when the tab regains focus. On the Hobby
// plan the platform cron only runs once/day, so this is what makes scheduled
// sends and due follow-ups go out close to their chosen time in practice.
export default function AutoDispatch() {
  useEffect(() => {
    const tick = () => fetch("/api/dispatch/tick").catch(() => {});
    tick();
    const interval = setInterval(tick, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
