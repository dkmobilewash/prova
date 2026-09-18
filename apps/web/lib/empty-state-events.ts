/**
 * The two things an empty state can ask the app chrome to do: start this
 * page's walkthrough, and open the assistant with a sentence already typed.
 *
 * Both live in chrome the page does not own — the tour is mounted by
 * `HelpButton` and the assistant by `AskLauncher`, both in the Topbar — so
 * the empty state cannot call them. A window event is the smallest seam that
 * does not make the Topbar know about every page, or every page know about
 * the Topbar.
 *
 * Deliberately NOT a "use client" module: a constant exported from one
 * crosses the RSC boundary as a client-reference proxy (the Hint.tsx scar in
 * CLAUDE.md), and a string that arrives as a proxy never equals the string
 * the listener registered.
 */

/** Dispatched on `window`; `HelpButton` starts the current page's tour. */
export const WALKTHROUGH_EVENT = "cstream:walkthrough";

/** Dispatched on `window` with the sentence as `detail`; every mounted
 * `AskPanel` puts it in its box. It is never sent — the person reads it and
 * presses Ask themselves. */
export const ASK_PREFILL_EVENT = "cstream:ask-prefill";

/**
 * A sentence waiting for an AskPanel that has not mounted yet.
 *
 * The launcher's panel only exists while it is open, so the event above
 * reaches nobody when the empty state asks first and opens second. The panel
 * takes this on mount. Module state, not storage: it only needs to survive
 * the one click, and a sentence left in sessionStorage would reappear in the
 * box on some later, unrelated visit.
 */
let pendingAsk: string | null = null;

export function setPendingAsk(text: string | null): void {
  pendingAsk = text;
}

/** Returns the waiting sentence once, then forgets it. */
export function takePendingAsk(): string | null {
  const text = pendingAsk;
  pendingAsk = null;
  return text;
}
