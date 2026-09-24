"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Play this once, when it is looked at" — the one piece of JavaScript the
 * two animated figures on the public landing page share
 * (SubmittalStamp.tsx, RetainageCountUp.tsx).
 *
 * It owns no motion. It answers one question — is this element on screen
 * for a reader who has not asked for less motion — and the caller puts the
 * answer in a `data-motion-play` attribute. Everything that actually moves
 * is a CSS animation in globals.css, selected on that attribute and living
 * inside the one `prefers-reduced-motion: no-preference` block, so the
 * motion is gated TWICE and independently: once here, where `playing` can
 * never become true under reduced motion, and once in the stylesheet,
 * where a bug in this file still cannot move anything. That is the shape
 * Reveal.tsx and FactTicker.tsx already hold, and the reason is the same —
 * either layer can regress without the other noticing.
 *
 * SAFE AT REST, WHICH HERE MEANS FINISHED. `playing` starts false, so the
 * server render, a browser with JavaScript off, and a reader with reduced
 * motion all get the same markup: the stamp landed, the figure at its real
 * value, the bar full. There is no early frame to be stuck on and nothing
 * parked at `opacity: 0` waiting for an observer that may never fire. So
 * the fallbacks here are allowed to be dull: if there is no
 * IntersectionObserver the figure simply never plays, and the page is
 * still correct, which is the opposite trade from AskDemo.tsx (whose rest
 * state is one frame of a scene, so it MUST play).
 *
 * IT REPLAYS. The observer is not disconnected on the first sighting, the
 * way Reveal's is: leaving view sets `playing` false, which removes the
 * animation rule, and coming back sets it true again, which starts the
 * animation from its first keyframe. Both of these are under a second and
 * a half and neither loops, so nothing here needs a pause control
 * (WCAG 2.2.2 is about content that moves for more than five seconds) —
 * and scrolling back to a figure to watch it again is the obvious thing a
 * person does, which a play-once-per-page-load animation answers with
 * nothing.
 *
 * A reduced-motion CHANGE is honoured while the page is open: the media
 * query is listened to, not merely read once at mount.
 */

/** How much of the figure must be on screen before it plays. The same
 * ratio AskDemo.tsx uses, for the same reason: a sliver at the bottom edge
 * is not "being looked at". */
const VISIBLE_RATIO = 0.35;

export function useMotionCue<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    /** One place decides: on screen AND nobody asked for less motion. */
    const apply = () => setPlaying(inView && !query.matches);

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") {
      // Nothing can tell us it is on screen. Leave it at rest — which is
      // the finished state, and correct. See the note above.
      inView = false;
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          inView = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
          apply();
        },
        { threshold: [0, VISIBLE_RATIO] },
      );
      observer.observe(el);
    }

    query.addEventListener("change", apply);
    return () => {
      observer?.disconnect();
      query.removeEventListener("change", apply);
    };
  }, []);

  return { ref, playing };
}

/** The attribute value the CSS selects on. One function so the two figures
 * cannot spell it differently, and so the at-rest value is written down
 * once: "idle" is what the server renders. */
export function motionPlayState(playing: boolean): "playing" | "idle" {
  return playing ? "playing" : "idle";
}
