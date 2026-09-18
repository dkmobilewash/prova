"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canOpen } from "@/components/navItems";
import { WalkthroughTour, isAnchorShown } from "@/components/WalkthroughTour";
import { routeMatches } from "@/lib/walkthroughs";
import {
  FULL_TOUR_EVENT,
  browserTourState,
  setBrowserTourState,
  stopAfter,
  stopBefore,
  stopsFor,
} from "@/lib/walkthroughs/full-tour";
import type { Principal } from "@/lib/permissions";

/** How long a stop's page gets to put one of its anchors on screen before
 * the stop is skipped. Long enough for a cold database wake; a stop that
 * still shows nothing after this has nothing to show this viewer. */
const ARRIVAL_TIMEOUT_MS = 12_000;
const ARRIVAL_POLL_MS = 150;

/**
 * The runner for "Take the full tour" — one per app shell, in the layout,
 * so it survives the page changes it causes.
 *
 * It owns exactly three things: which stop the tour is on (mirrored to
 * sessionStorage, so a reload resumes it), moving to that stop's page with
 * a client-side router push, and waiting for the page to put one of the
 * stop's anchors on screen. Everything drawn on the page is the per-page
 * tour's own overlay, handed one stop at a time.
 *
 * NAVIGATING IS ALL IT DOES TO THE APP. It never clicks, types or saves;
 * a card that says "press Create job" leaves the pressing to the person.
 *
 * If the person leaves the stop's page themselves — follows a link the tour
 * pointed at, say — the card goes and a small "Tour paused" note stays, with
 * Resume and End. The tour never drags someone back to where it wanted them.
 */
export function FullTour({ principal }: { principal: Principal }) {
  const router = useRouter();
  const pathname = usePathname();
  const { role, jobFunction } = principal;
  const stops = useMemo(
    () => stopsFor((route) => canOpen({ role, jobFunction }, route)),
    [role, jobFunction],
  );

  const [stopId, setStopId] = useState<string | null>(null);
  /** True while the TOUR is moving the person to the stop's page, as
   * against the person having wandered off it. */
  const [steering, setSteering] = useState(false);
  /** The stop whose page has one of its anchors on screen. */
  const [ready, setReady] = useState<string | null>(null);
  const pushedFor = useRef<string | null>(null);

  const go = useCallback((id: string | null) => {
    setBrowserTourState(id ? { stop: id } : null);
    setStopId(id);
    setReady(null);
    setSteering(id !== null);
    pushedFor.current = null;
  }, []);

  // Pick the tour up: on mount (a reload mid-tour resumes, without moving
  // anyone), and whenever an entry point starts it (which does move them).
  useEffect(() => {
    const resume = browserTourState();
    setStopId(resume?.stop ?? null);
    const onStart = () => {
      const state = browserTourState();
      setStopId(state?.stop ?? null);
      setReady(null);
      setSteering(state !== null);
      pushedFor.current = null;
    };
    window.addEventListener(FULL_TOUR_EVENT, onStart);
    return () => window.removeEventListener(FULL_TOUR_EVENT, onStart);
  }, []);

  const stop = stops.find((candidate) => candidate.id === stopId) ?? null;
  const onStopPage = stop !== null && routeMatches(stop.route, pathname);

  // A remembered stop this viewer cannot open (their access changed, or an
  // entry point started at a stop that is not theirs): move on to the next
  // one they can, rather than sit on nothing.
  useEffect(() => {
    if (stopId !== null && stop === null) go(stopAfter(stops, stopId)?.id ?? null);
  }, [stopId, stop, stops, go]);

  // Take them to the stop's page — once per stop, and only when the tour
  // itself is doing the moving.
  useEffect(() => {
    if (!stop || !steering || onStopPage || pushedFor.current === stop.id) return;
    pushedFor.current = stop.id;
    router.push(stop.route);
  }, [stop, steering, onStopPage, router]);

  // Off the stop's page, the card has nothing to point at.
  useEffect(() => {
    if (!onStopPage) setReady(null);
  }, [onStopPage]);

  // On the page: wait for one of the stop's anchors, then show the card. A
  // stop whose page never shows one — every anchor behind a state this
  // account is not in — is skipped rather than shown pointing at nothing.
  useEffect(() => {
    if (!stop || !onStopPage || ready === stop.id) return;
    setSteering(false);
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (stop.steps.some((step) => isAnchorShown(step.anchor))) {
        window.clearInterval(timer);
        setReady(stop.id);
      } else if (Date.now() - started > ARRIVAL_TIMEOUT_MS) {
        window.clearInterval(timer);
        go(stopAfter(stops, stop.id)?.id ?? null);
      }
    }, ARRIVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [stop, onStopPage, ready, stops, go]);

  if (!stop) return null;

  const number = stops.indexOf(stop) + 1;
  const previous = stopBefore(stops, stop.id);
  const next = stopAfter(stops, stop.id);

  if (onStopPage && ready === stop.id) {
    return (
      <WalkthroughTour
        // One mount per stop, so each starts on its own first card.
        key={stop.id}
        walkthrough={{ route: stop.route, title: stop.title, steps: stop.steps }}
        journey={{
          stop: number,
          stops: stops.length,
          onBackPast: previous ? () => go(previous.id) : null,
          onSkip: () => go(next?.id ?? null),
        }}
        onClose={(finished) => go(finished ? (next?.id ?? null) : null)}
      />
    );
  }

  // Between pages: either the tour is taking them there, or they left.
  return (
    <div
      role="status"
      className="fixed bottom-20 right-4 z-[60] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-card bg-surface px-4 py-2 text-sm text-ink shadow-xl"
    >
      <span>
        {steering || onStopPage ? "Opening" : "Tour paused ·"} stop {number} of {stops.length}: {stop.title}
        {steering || onStopPage ? "…" : ""}
      </span>
      {!steering && !onStopPage && (
        <button
          type="button"
          onClick={() => {
            pushedFor.current = null;
            setSteering(true);
          }}
          className="inline-flex min-h-11 items-center font-semibold text-link hover:text-link-hover hover:underline"
        >
          Resume
        </button>
      )}
      <button
        type="button"
        onClick={() => go(null)}
        className="inline-flex min-h-11 items-center text-ink-body hover:text-ink hover:underline"
      >
        End tour
      </button>
    </div>
  );
}
