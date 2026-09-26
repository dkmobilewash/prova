"use client";

import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

/**
 * Clerk's `<UserButton>`, held back until after hydration.
 *
 * WHAT IT FIXES. `UserButton` renders NOTHING during server rendering and
 * a mount div on the client — `@clerk/nextjs` 6.9.6 defers to clerk-js,
 * which does not exist on the server. React's own words, from a dev-server
 * E2E run on 2026-09-24 (the `+` is the node the client added and the
 * server never sent):
 *
 *     <ClerkHostRenderer component="UserButton" mount={function} …>
 *   +   <div ref={{current:null}} data-clerk-component="UserButton">
 *
 * A node present on one side and absent on the other is a hydration
 * mismatch. This sits in the Topbar, which `app/(app)/layout.tsx` mounts
 * on EVERY authenticated page, so it was one React error per full page
 * load across the whole signed-in app.
 *
 * HOW IT COST A DAY, which is the part worth keeping. Production React
 * strips its own error arguments — the mismatch arrives as `#418` with
 * args `["HTML", ""]`, naming the page and never the element — so the E2E
 * suite could say WHERE and never WHAT. Four hypotheses were read out of
 * the shell's 85 transitive imports and all four were wrong, including one
 * probe that "cleared" the Topbar because it had mocked `UserButton` away.
 * `E2E_DEV_SERVER=1` (e2e/playwright.config.ts) printed the component
 * stack above in a single run. Reach for that first next time.
 *
 * THE COST OF THE FIX. The avatar appears one frame after the rest of the
 * chrome. The placeholder is the same 28px circle Clerk renders, so
 * nothing moves when it arrives — a spinner or a skeleton shimmer would be
 * louder than the thing it stands in for.
 *
 * WHY NOT `suppressHydrationWarning`. It silences the warning on ONE
 * element's own attributes and text; it does not reconcile a subtree the
 * server never sent, and it would leave the mismatch happening while
 * hiding the evidence — which is this repo's least favourite shape.
 */
export function UserMenu() {
  // Starts false so the SERVER's markup and the first CLIENT render are
  // the same thing. The effect runs after hydration has already matched.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return (
      <div
        className="h-7 w-7 shrink-0 rounded-full bg-ink-faint/20"
        // Nothing to announce: the real control replaces this within a
        // frame, and a screen reader hearing "loading" for one frame is
        // noise rather than information.
        aria-hidden="true"
      />
    );
  }

  return <UserButton />;
}
