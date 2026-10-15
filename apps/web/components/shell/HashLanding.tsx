"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Lands a cross-page `#anchor` link on its section once the page arrives.
 *
 * Next scrolls to a hash itself, but a loading boundary defeats it (the
 * (app) one is gone since #748; a route-level one would do the same): the
 * router's scroll handler sits OUTSIDE the loading boundary, so it fires
 * while the skeleton is showing, finds no element with that id, scrolls to
 * the skeleton instead and is spent before the real page streams in. So
 * Home's "Retainage held →" (/cash-flow#retainage), "Log hours"
 * (crew#log-time) and "Log a change order" (estimate#change-orders) all
 * opened at the top of the page (ux round 4).
 *
 * After each navigation: if the URL carries a hash, wait for that id to
 * exist and scroll it into view once. Gives up after ten seconds.
 *
 * A FRESH page load (pasted link, reload) needs one more condition, and it
 * is why /cash-flow#retainage opened at the top while click-through worked
 * (ux round 5). On a full load React streams the page into a
 * `<div hidden id="S:…">` first and only moves it into place when the
 * boundary is revealed (React 19.2 batches reveals, so it sits there a
 * while). The id EXISTS inside that hidden div, scrolling a display:none
 * element does nothing, and the old check counted "found" as "landed" and
 * stopped watching. So the section only counts once it is out of `[hidden]`.
 */
export function HashLanding() {
  const pathname = usePathname();
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const land = () => {
      const target = document.getElementById(id);
      if (!target || target.closest("[hidden]")) return false;
      target.scrollIntoView?.({ block: "start" });
      return true;
    };
    if (land()) return;
    const observer = new MutationObserver(() => {
      if (land()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    const stop = window.setTimeout(() => observer.disconnect(), 10_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [pathname]);
  return null;
}
