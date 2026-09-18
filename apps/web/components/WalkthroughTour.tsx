"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Walkthrough } from "@/lib/walkthroughs";
import { placeCard, stepAfter, stepBefore, stepPosition, shownSteps, type Rect } from "@/lib/walkthroughs/engine";

/**
 * "Walk me through this page": highlights one real element at a time and
 * says, in a sentence or two, what it is and what to do with it.
 *
 * WHY OUR OWN AND NOT A LIBRARY. The tour libraries (driver.js, shepherd,
 * react-joyride) each bring their own stylesheet to fight the theme tokens,
 * and none of them does the one thing this needs most: re-ask which steps
 * are on screen at every move, so a step hidden by the viewer's role or by
 * a closed section is skipped rather than pointed at nothing. The whole
 * overlay is a spotlight, a card and a key handler — smaller than the
 * adapter a library would have needed.
 *
 * IT NEVER TOUCHES THE PAGE. It does not click, type, open or save
 * anything; it scrolls the element into view and draws around it. The
 * shade lets clicks through, so a step that says "press Import clients" can
 * be done with the tour still open — and the next step, inside the section
 * that just opened, is then there to be shown.
 *
 * ON A PHONE IT IS A SHEET ALONG THE BOTTOM, not a floating card: at 375px
 * a card beside the element has nowhere to go but over it. The element is
 * scrolled to the top of the screen instead, clear of the sheet — and when
 * it cannot be (the last thing on the page), the sheet moves to the top.
 */

const PHONE = "(max-width: 639px)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function isVisible(element: Element): boolean {
  if (element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The first element on the page carrying this anchor that is actually
 * rendered — a page can render one anchor in two layouts and show one. */
export function findAnchor(anchor: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`);
  for (const element of all) if (isVisible(element)) return element;
  return null;
}

export function isAnchorShown(anchor: string): boolean {
  return findAnchor(anchor) !== null;
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function WalkthroughTour({
  walkthrough,
  onClose,
  returnFocusTo,
}: {
  walkthrough: Walkthrough;
  /** `finished` is true only when they pressed Done on the last step. */
  onClose: (finished: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const { steps } = walkthrough;
  // Mounted only after a click, so the page is there to be read.
  const [current, setCurrent] = useState<string | null>(
    () => shownSteps(steps, isAnchorShown)[0]?.anchor ?? null,
  );
  const [rect, setRect] = useState<Rect | null>(null);
  // Only here to re-render when the set of steps on screen changes; the
  // value itself is read from the page at render time.
  const [, setShownSignature] = useState("");
  const [cardSize, setCardSize] = useState({ width: 352, height: 200 });
  const isPhone = useMedia(PHONE);
  const reducedMotion = useMedia(REDUCED_MOTION);
  const dialog = useRef<HTMLDivElement | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);

  const step = steps.find((candidate) => candidate.anchor === current) ?? null;
  const next = current ? stepAfter(steps, current, isAnchorShown) : null;
  const previous = current ? stepBefore(steps, current, isAnchorShown) : null;
  const position = current ? stepPosition(steps, current, isAnchorShown) : { index: 0, total: 0 };

  const close = useCallback((finished: boolean) => onClose(finished), [onClose]);

  // Nothing on screen to show (the Help panel checks first, so this is a
  // page that changed between the click and the mount): close quietly
  // rather than open a card that points at nothing.
  useEffect(() => {
    if (current === null) close(false);
  }, [current, close]);

  // Bring the element into view each time the step changes.
  useEffect(() => {
    if (!current) return;
    const element = findAnchor(current);
    if (!element) return;
    const tall = element.getBoundingClientRect().height > window.innerHeight * 0.6;
    element.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: isPhone || tall ? "start" : "center",
    });
  }, [current, isPhone, reducedMotion]);

  // Follow the element while it scrolls, resizes or moves because the page
  // changed under it. One rect read a frame, and a render only when it moved.
  useEffect(() => {
    if (!current) return;
    let frame = 0;
    let count = 0;
    const tick = () => {
      const element = findAnchor(current);
      const box = element?.getBoundingClientRect();
      const next: Rect | null = box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null;
      setRect((previousRect) => (sameRect(previousRect, next) ? previousRect : next));
      // Every quarter second, which steps are on screen — so "Next" turns
      // back from "Done" when the person opens a section the tour has more
      // to say about, and the step count stays true.
      if (count++ % 15 === 0) {
        const signature = shownSteps(steps, isAnchorShown)
          .map((shown) => shown.anchor)
          .join(" ");
        setShownSignature((previousSignature) => (previousSignature === signature ? previousSignature : signature));
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [current, steps]);

  useLayoutEffect(() => {
    const box = dialog.current?.getBoundingClientRect();
    if (box && (box.width !== cardSize.width || box.height !== cardSize.height)) {
      setCardSize({ width: box.width, height: box.height });
    }
  }, [current, isPhone, cardSize.width, cardSize.height]);

  // Focus: into the card on open, back to where it came from on close.
  useEffect(() => {
    dialog.current?.focus();
    const target = returnFocusTo?.current;
    return () => {
      if (target && target.isConnected) target.focus();
    };
  }, [returnFocusTo]);

  // A step change can remove the button that had focus (Back on the first
  // step); put it on the main button rather than let it fall to the page.
  useEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) {
      primary.current?.focus();
    }
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  if (!step || !current) return null;

  const goNext = () => {
    // Asked again at the click: the page may have changed since render.
    const after = stepAfter(steps, current, isAnchorShown);
    if (after) setCurrent(after.anchor);
    else close(true);
  };
  const goBack = () => {
    const before = stepBefore(steps, current, isAnchorShown);
    if (before) setCurrent(before.anchor);
  };

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" && next) {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === "ArrowLeft" && previous) {
      event.preventDefault();
      goBack();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const pad = 6;
  const cardPlace =
    !isPhone && rect
      ? placeCard(
          { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 },
          cardSize,
          { width: window.innerWidth, height: window.innerHeight },
        )
      : null;
  // A sheet at the bottom covers the last few inches of a page, and the last
  // element on a page cannot scroll any higher. When the element would sit
  // under the sheet and there is room above it, the sheet moves to the top.
  const sheetAtTop =
    isPhone &&
    rect !== null &&
    rect.top + rect.height > window.innerHeight - cardSize.height &&
    rect.top >= cardSize.height + 8;
  const isLast = next === null;
  const titleId = `walkthrough-title-${current}`;
  const bodyId = `walkthrough-body-${current}`;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" data-walkthrough-overlay="">
      {rect ? (
        <div
          aria-hidden="true"
          className="absolute rounded-lg outline outline-2 outline-brand motion-safe:transition-all motion-safe:duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            // The shade is the spotlight's own shadow, so the element stays
            // at full brightness and nothing sits on top of it. The yellow
            // edge is an OUTLINE, not a Tailwind ring: a ring is a
            // box-shadow too, and this inline one would replace it.
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
      )}

      <div
        ref={dialog}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={
          isPhone
            ? sheetAtTop
              ? "pointer-events-auto fixed inset-x-0 top-0 max-h-[60dvh] overflow-y-auto rounded-b-xl border-b border-line-card bg-surface p-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand"
              : "pointer-events-auto fixed inset-x-0 bottom-0 max-h-[60dvh] overflow-y-auto rounded-t-xl border-t border-line-card bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand"
            : "pointer-events-auto fixed w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line-card bg-surface p-4 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand motion-safe:transition-[top,left] motion-safe:duration-200"
        }
        style={
          isPhone
            ? undefined
            : cardPlace
              ? { top: cardPlace.top, left: cardPlace.left }
              : { bottom: 16, right: 16 }
        }
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-ink-body">
            Step {position.index} of {position.total} · {walkthrough.title}
          </p>
          <button
            type="button"
            onClick={() => close(false)}
            aria-label="Close the walkthrough"
            className="-mr-2 -mt-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-body hover:bg-rail-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Polite, so a screen reader hears each step as it changes without
            the person having to hunt for it. */}
        <div aria-live="polite">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {step.title}
          </h2>
          <p id={bodyId} className="mt-1 text-sm leading-relaxed text-ink-body">
            {step.body}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {/* Absent on the first step rather than greyed out: a button that
              does nothing reads as broken. */}
          {previous && (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 text-sm text-ink-label hover:bg-rail-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Back
            </button>
          )}
          <button
            ref={primary}
            type="button"
            onClick={goNext}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
