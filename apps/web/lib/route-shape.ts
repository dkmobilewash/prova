/**
 * Is this string a path a browser can open, or a Next.js route PATTERN?
 *
 * THE DISTINCTION IS NOT COSMETIC AND IT HAS SHIPPED TWICE. `app/` writes
 * a job-detail tab as `/jobs/[id]/billing`, and that is what the
 * walkthrough registry stores as its `route`. Handed to `<Link href>` it
 * navigates to `/jobs/%5Bid%5D/billing` — "This page doesn't exist." The
 * brackets survive as percent-encoding; nothing throws, nothing logs, and
 * the person just lands on a 404 having been told confidently to go there.
 *
 * Global search shipped that in #386 and is fixed in #408. Ask shipped the
 * same string from the same registry through `app_help`'s citations, which
 * `AskPanel` renders as `<Link>` — the defect this module exists for.
 *
 * WHY IT IS HERE AND NOT IN EITHER SURFACE. Two callers that must agree
 * about what 404s cannot each keep their own copy of the rule; that is the
 * shape CLAUDE.md records for the three implementations of hours rounding.
 * This file imports nothing, so search, Ask, and anything else that turns a
 * registry route into an href can all reach it.
 *
 * NOT a permission check. A route can be perfectly openable and still be
 * refused to this person — `capabilityForRoute`/`can` answer that, and
 * `reachableWalkthroughs` applies them before anything here runs.
 */

/** `[id]`, `[...slug]`, `[[...filters]]` — every dynamic segment shape
 * Next.js has, not just the one this app uses today. */
const DYNAMIC_SEGMENT = /^\[.*\]$/;

/** True when every segment is literal, so the string IS a path. */
export function isOpenableRoute(route: string): boolean {
  return !route.split("/").some((segment) => DYNAMIC_SEGMENT.test(segment));
}

/**
 * Where a person actually starts, for a route that is a pattern: the part
 * of it BEFORE the first dynamic segment. `/jobs/[id]/billing` -> `/jobs`,
 * which is the list they pick the job from.
 *
 * Returns the route itself when it is already openable, and `null` when
 * even the first segment is dynamic — no route in this app is, and the
 * census asserts that, but a null is a refusal to guess rather than a
 * `""` that would render as a link to the site root.
 *
 * THIS IS A STARTING POINT, NOT THE PAGE. A caller that hands it to
 * somebody without saying so has traded a fast, obvious 404 for a slow,
 * silent dead end — which is why #408 rejected it for a search ROW, whose
 * whole content is a link. Ask has prose and the page's own steps around
 * it, so it can say "open the job from here, then its Billing tab"; that
 * difference is the entire reason the two surfaces share this predicate
 * and not a behaviour.
 */
export function openableStartFor(route: string): string | null {
  const segments = route.split("/");
  const firstDynamic = segments.findIndex((segment) => DYNAMIC_SEGMENT.test(segment));
  if (firstDynamic === -1) return route;
  const prefix = segments.slice(0, firstDynamic).join("/");
  return prefix === "" ? null : prefix;
}
