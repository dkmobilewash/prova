"use client";

import type { ReactNode } from "react";

/**
 * THE PAGE'S SLOT IN `<main>`, AND WHY `<main>` MUST NOT HOLD THE PAGE
 * DIRECTLY. #510 — the residual React #418 that failed the pilot journey's
 * step 11 on almost every CI run — measured to the fiber in a production
 * build (e2e/probes/mismatch-locator.probe.spec.ts; CLAUDE.md's #418 entry):
 *
 *   - `<main>`'s child is Next's LayoutRouter element, and its props carry
 *     the `(app)/error.tsx` client module. When that module's chunk has not
 *     executed by the time the Flight row is parsed, the Flight client wraps
 *     the whole element in a LAZY (`createLazyChunkWrapper`).
 *   - A lazy in CHILD position suspends the PARENT's beginWork. When the
 *     parent is a HOST element, React's `replaySuspendedUnitOfWork` re-runs
 *     that host's beginWork from the top — and the first attempt has already
 *     moved the hydration cursor INTO it. So the replay tries to claim a
 *     `<main>` and finds the page's own first `<div>`: an element-level
 *     mismatch, `args[]=HTML`, with no Suspense boundary above it, so the
 *     whole root is regenerated.
 *
 * A function component in between takes the suspension instead. It claims no
 * DOM node, so its replay cannot re-claim one. Its own element is safe to
 * write in the server layout: if this module's chunk is late, the element's
 * TYPE is a lazy, which React mounts as a fiber of its own (it does not
 * suspend `<main>`); only an element whose PROPS hold an unloaded module is
 * wrapped whole, and this one's only prop is the page.
 *
 * Its own file rather than AppChrome.tsx, because that module's rule is that
 * nothing in it takes `children` — a region that cannot be given children
 * cannot be given the page (components/shellRegion.test.ts). This is the one
 * component whose whole job is to be given the page.
 * `components/pageSlot.test.tsx` reproduces the mismatch without it.
 */
export function PageSlot({ children }: { children: ReactNode }) {
  return children;
}
