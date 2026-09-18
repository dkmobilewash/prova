import type { WalkthroughStep } from "./types";

/**
 * The parts of the tour that are arithmetic rather than DOM, kept pure so
 * they are tested without a browser (engine.test.ts). The overlay
 * (components/WalkthroughTour.tsx) supplies `isShown` from the real page.
 */

/** The steps whose anchor is on screen right now, in order.
 *
 * Asked again on every move rather than once at the start: the person can
 * click the page while the tour is open — open "Import clients", say — and
 * a step that was hidden a moment ago is then there to be shown. */
export function shownSteps(
  steps: WalkthroughStep[],
  isShown: (anchor: string) => boolean,
): WalkthroughStep[] {
  return steps.filter((step) => isShown(step.anchor));
}

/** The first shown step after `anchor` in the walkthrough's own order, or
 * null when it is the last one on screen. Uses the FULL list for order, so
 * a step that was the current one can itself have disappeared (its section
 * closed) and Next still goes forward rather than back to the start. */
export function stepAfter(
  steps: WalkthroughStep[],
  anchor: string,
  isShown: (anchor: string) => boolean,
): WalkthroughStep | null {
  const at = steps.findIndex((step) => step.anchor === anchor);
  return steps.slice(at + 1).find((step) => isShown(step.anchor)) ?? null;
}

export function stepBefore(
  steps: WalkthroughStep[],
  anchor: string,
  isShown: (anchor: string) => boolean,
): WalkthroughStep | null {
  const at = steps.findIndex((step) => step.anchor === anchor);
  if (at <= 0) return null;
  return (
    steps
      .slice(0, at)
      .reverse()
      .find((step) => isShown(step.anchor)) ?? null
  );
}

/** "Step 2 of 6", counted over what is on screen — a count that included
 * skipped steps would promise six and deliver four. */
export function stepPosition(
  steps: WalkthroughStep[],
  anchor: string,
  isShown: (anchor: string) => boolean,
): { index: number; total: number } {
  const shown = shownSteps(steps, isShown);
  const index = shown.findIndex((step) => step.anchor === anchor);
  // The current step can vanish under the person (they closed its section).
  // It is still the one on the card, so it still counts.
  if (index === -1) {
    const at = steps.findIndex((step) => step.anchor === anchor);
    const before = shown.filter((step) => steps.indexOf(step) < at).length;
    return { index: before + 1, total: shown.length + 1 };
  }
  return { index: index + 1, total: shown.length };
}

export type Rect = { top: number; left: number; width: number; height: number };

/** Where the floating card goes on a screen wide enough for one.
 *
 * Below the highlighted element if it fits, above it if that fits, and
 * otherwise — the element is taller than the room left, a whole list, say —
 * pinned to the bottom of the screen over the element, which is still
 * highlighted around it. Always kept `margin` inside the screen. */
export function placeCard(
  target: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 12, margin = 16 }: { gap?: number; margin?: number } = {},
): { top: number; left: number } {
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);
  const left = Math.min(Math.max(target.left, margin), maxLeft);
  const below = target.top + target.height + gap;
  if (below + card.height <= viewport.height - margin) return { top: below, left };
  const above = target.top - gap - card.height;
  if (above >= margin) return { top: above, left };
  return { top: Math.max(margin, viewport.height - card.height - margin), left };
}

/** Which walkthroughs this browser has been through to the end. Stored as
 * a list of routes. Per browser, on purpose: it only changes a label from
 * "Walk me through this page" to "…again", which is not worth a database
 * row, and a missing or unreadable value just means the first wording. */
export const FINISHED_KEY = "cstream:walkthroughs:finished";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readFinished(storage: Storage | null | undefined): string[] {
  try {
    const raw = storage?.getItem(FINISHED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function markFinished(storage: Storage | null | undefined, route: string): void {
  try {
    const current = readFinished(storage);
    if (current.includes(route)) return;
    storage?.setItem(FINISHED_KEY, JSON.stringify([...current, route]));
  } catch {
    // Private browsing, storage full, or blocked: the tour still worked,
    // the label just will not say "again".
  }
}

/** `window.localStorage`, or null when even touching it throws (some
 * browsers do, with site data blocked). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
