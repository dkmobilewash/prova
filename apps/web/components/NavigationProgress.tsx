"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/**
 * A 2px bar along the top of the screen that starts the moment an in-app
 * link is clicked and finishes when the new route has rendered. Pages here
 * take 1.5–7s (CLAUDE.md #61/#118) and before this nothing moved after a
 * click, which reads as frozen and invites a second click.
 *
 * No dependency and no router patching: a capture-phase click listener
 * starts it (capture, because next/link calls preventDefault in its own
 * handler before a bubbling listener would see the event), and a change in
 * pathname or search params finishes it. Programmatic router.push and the
 * back button do not start it — app/(app)/loading.tsx still covers those.
 *
 * Motion is transform-only. Under prefers-reduced-motion the bar still
 * appears (it is status, not decoration) but never animates: barStyle()
 * zeroes the duration, and the transition PROPERTY only exists under
 * `motion-safe:` on the element — a second, CSS-level net in case the JS
 * read of the preference is wrong (an inline `transition` would beat any
 * class, which is why the property is not inline)
 * — same twin-gate shape as components/Reveal.tsx.
 */

import { barStyle, startsNavigation, type Phase } from "@/lib/navProgress";

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [phase, setPhase] = useState<Phase>("idle");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (!startsNavigation(e, { href: a.href, target: a.target, download: a.hasAttribute("download") }, location.href)) return;
      setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
      setPhase("start");
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new route rendered: finish whatever is running.
  useEffect(() => {
    setPhase((p) => (p === "start" || p === "loading" ? "done" : p));
  }, [pathname, search]);

  useEffect(() => {
    if (phase === "idle") return;
    // start -> loading needs one painted frame at the start scale, or the
    // browser never sees the transition begin.
    if (phase === "start") {
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("loading")));
      return () => cancelAnimationFrame(raf);
    }
    // ponytail: a navigation that never changes the URL (a link whose page
    // throws to error.tsx, a cancelled click) is finished by this cap, not detected.
    const t = setTimeout(() => setPhase(phase === "done" ? "idle" : "done"), phase === "done" ? 250 : 15000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;
  return (
    <div
      aria-hidden="true"
      data-nav-progress={phase}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-brand text-neutral-900 motion-safe:transition-transform"
      style={barStyle(phase, reduced)}
    />
  );
}

export function NavigationProgress() {
  // useSearchParams needs a Suspense boundary; a suspended bar renders nothing.
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
