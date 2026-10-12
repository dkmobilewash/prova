"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Lands a cross-page `#anchor` link on its section once the page arrives.
 *
 * Next scrolls to a hash itself, but `(app)/loading.tsx` defeats it: the
 * router's scroll handler sits OUTSIDE the loading boundary, so it fires
 * while the skeleton is showing, finds no element with that id, scrolls to
 * the skeleton instead and is spent before the real page streams in. So
 * Home's "Retainage held →" (/cash-flow#retainage), "Log hours"
 * (crew#log-time) and "Log a change order" (estimate#change-orders) all
 * opened at the top of the page (ux round 4).
 *
 * After each navigation: if the URL carries a hash, wait for that id to
 * exist and scroll it into view once. Gives up after ten seconds.
 */
export function HashLanding() {
  const pathname = usePathname();
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const land = () => {
      const target = document.getElementById(id);
      target?.scrollIntoView?.({ block: "start" });
      return target !== null;
    };
    if (land()) return;
    const observer = new MutationObserver(() => {
      if (land()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const stop = window.setTimeout(() => observer.disconnect(), 10_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [pathname]);
  return null;
}
