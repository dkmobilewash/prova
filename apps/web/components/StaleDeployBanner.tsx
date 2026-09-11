"use client";

import { useEffect, useState } from "react";
import { attachStaleDeployListener } from "@/lib/stale-deploy-error";

/**
 * A safety net for #118. `(app)/error.tsx` can only ever see errors React
 * itself sees during render or a commit -- an async fetch callback or an
 * awaited dynamic import outside a transition throws OUTSIDE that
 * entirely, as an uncaught exception or an unhandled rejection that never
 * reaches any boundary. Without this, that specific failure either goes
 * silent or falls through to Next's own generic "client-side exception"
 * screen with no next step for the person looking at it.
 *
 * RENDERS NOTHING until the listener actually fires, same shape as
 * TimeZoneCookie -- no markup to disagree about on a normal page, so this
 * cannot itself break hydration.
 *
 * Deliberately narrow: `attachStaleDeployListener` only calls back for the
 * one error shape a hard reload actually fixes (see
 * lib/stale-deploy-error.ts). Anything else is left exactly as loud as it
 * already was -- this is not a blanket error swallower, and it does not
 * try to suppress whatever else the browser or Next does with the same
 * error; it only adds a plain next step on top.
 */
export function StaleDeployBanner() {
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    return attachStaleDeployListener(() => setDetected(true));
  }, []);

  if (!detected) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-tag-amber px-4 py-3 text-center text-sm text-tag-amber-ink"
    >
      A new version of Prova was published while this page was open.{" "}
      <span className="font-medium">Finish anything you&apos;re typing first</span> — reloading
      discards unsaved form fields, but nothing you&apos;ve already saved is at risk.{" "}
      <button
        onClick={() => window.location.reload()}
        className="ml-2 rounded-md bg-amber-700 px-3 py-1 font-medium text-white hover:bg-amber-600"
      >
        Reload now
      </button>
    </div>
  );
}
