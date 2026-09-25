"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Renders NOTHING until the browser has mounted, and its children after.
 *
 * WHAT IT IS FOR, and it is one narrow thing: a third-party component that
 * decides what to render from a mutable flag it reads DURING render, where
 * that flag is always false on the server. Clerk's `<UserButton>` is the
 * case this was written for — `clerk.loaded && <ClerkHostRenderer …/>`, read
 * out of `@clerk/clerk-react@5.61.9`, `chunk-THNCS7QR.mjs:669`. On the
 * server `loaded` is false and the server writes no markup for it at all.
 * In the browser the FIRST render — the hydration render — reads the same
 * flag, and by then Clerk's script may already have loaded, in which case
 * React renders an element the server's HTML does not have. That is an
 * ELEMENT-level hydration mismatch (React #418 says `HTML`, not `text`) on
 * a component the signed-in top bar mounts on every page.
 *
 * WHY THIS IS SAFE AND COSTS NOTHING TO LOOK AT. The server already renders
 * nothing here, so making the first CLIENT render agree cannot change what
 * anybody sees — it can only remove the disagreement. `mounted` starts false
 * on both sides and is set in an effect, which runs after the first render
 * has already matched.
 *
 * WHAT IT IS NOT FOR. It is not a way to dodge a hydration mismatch in our
 * own components. Anything that renders real content this way appears a
 * frame late and is invisible to a reader with JavaScript off — see
 * components/localToday.ts for the same rule about dates. Use it only where
 * the server renders nothing already.
 */
export function AfterMount({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : null;
}
