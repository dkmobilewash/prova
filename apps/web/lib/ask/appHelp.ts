import { WALKTHROUGHS, type Walkthrough } from "@/lib/walkthroughs";
import { capabilityForRoute, can, type Principal } from "@/lib/permissions";
import { isOpenableRoute, openableStartFor } from "@/lib/route-shape";

/**
 * "How do I…" answered from the app's own registered "Walk me through this
 * page" walkthroughs (lib/walkthroughs), instead of from a hand-written
 * FAQ that drifts from the product the moment somebody changes a button.
 * Every walkthrough already exists for the in-app tour; this reads the
 * same registry rather than a second copy of it, so a step corrected for
 * the tour is corrected here too.
 *
 * Pure and DB-free on purpose: the search and the capability filter below
 * are ordinary functions over WALKTHROUGHS, so they are unit-tested
 * directly, with no fake company and no fake session.
 */

/** Words too common to mean anything about WHICH page a question is about.
 * Kept short deliberately — a real construction word ("add", "log",
 * "connect") is exactly the word a walkthrough step is written around, and
 * must not be filtered out with the empty ones. */
const STOP_WORDS = new Set([
  "how",
  "do",
  "does",
  "did",
  "i",
  "the",
  "a",
  "an",
  "to",
  "on",
  "in",
  "for",
  "of",
  "and",
  "my",
  "is",
  "are",
  "can",
  "could",
  "would",
  "should",
  "where",
  "what",
  "when",
  "why",
  "it",
  "this",
  "that",
  "me",
  "you",
  "your",
  "we",
  "our",
  "please",
]);

/** Lowercase words, stop words and anything under two letters dropped. A
 * query of nothing but stop words ("how do I") yields no terms, which is
 * the signal below to say "not enough to search on" rather than return
 * every page. */
function queryTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** Whether `term` starts a WORD in `haystack` — a boundary before it, none
 * required after. Anchoring only the start, never the end, is what lets
 * "backcharge" find "Backcharges" (the plural) and "punch" find "punch
 * lists". Requiring the boundary AT ALL is what stops "log" from finding
 * "catalog": nothing precedes "log" there but the letter "a", so there is
 * no word start for it to be — caught by appHelp.test.ts, whose
 * "only searches the candidates it is given" case matched `/catalog` for
 * a "log a backcharge" query on plain substring matching, entirely by
 * coincidence of spelling. A plain `.includes` cannot tell a real match
 * from a word swallowing a shorter one whole. */
function startsWord(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term}`).test(haystack);
}

/** How strongly EACH term matched, at its single best location — title (6),
 * route (4), a step's own title (3), or just a step's body (1); 0 if the
 * term appears nowhere in this walkthrough. Each term counts once here, not
 * once per occurrence: an early version summed every hit, which let a
 * generic verb ("log", "add") that happens to appear in several unrelated
 * steps outscore a page that only weakly matches. */
function termScores(walkthrough: Walkthrough, terms: string[]): number[] {
  const titleHay = walkthrough.title.toLowerCase();
  const routeHay = walkthrough.route.toLowerCase();
  return terms.map((term) => {
    let best = 0;
    if (startsWord(titleHay, term)) best = Math.max(best, 6);
    if (startsWord(routeHay, term)) best = Math.max(best, 4);
    for (const step of walkthrough.steps) {
      if (startsWord(step.title.toLowerCase(), term)) best = Math.max(best, 3);
      else if (startsWord(step.body.toLowerCase(), term)) best = Math.max(best, 1);
    }
    return best;
  });
}

/**
 * Whether a walkthrough is a real answer to the question, as opposed to
 * sharing one incidental word with it. Two ways to qualify: ONE term hit
 * the walkthrough's own title or route (score >= 4) — the page is
 * genuinely named for the thing asked about — or at least TWO distinct
 * terms matched somewhere at all, even weakly.
 *
 * Caught by appHelp.test.ts, and it is the reason this is its own check
 * rather than a flat score floor: "log a backcharge", with the
 * backcharges page filtered out (a FIELD member cannot open it), still
 * surfaced the job detail page as though it answered the question — every
 * OTHER page mentions "log" too ("log time", "log a day"), and a floor
 * on total score alone cannot tell a walkthrough that matches the
 * question from one that happens to share its most common verb. Requiring
 * either a strong single hit or corroboration from a second term does:
 * "log" matching one page's body, alone, clears neither bar.
 */
function isRelevant(scores: number[]): boolean {
  if (scores.some((s) => s >= 4)) return true;
  return scores.filter((s) => s > 0).length >= 2;
}

export type AppHelpMatch = {
  /** The registry's own route, exactly as `app/` writes it — so a
   * PATTERN (`/jobs/[id]/billing`) for the six pages that live inside one
   * job. Kept because it is the truth about where the page is, and
   * NEVER usable as a link target — `href` below is that. */
  route: string;
  /** A path that actually resolves. Equal to `route` for an ordinary
   * page; for a pattern it is the list the person starts from, and
   * `insideOneJob` says so. */
  href: string;
  /** True when `href` is a starting point rather than the page itself —
   * the caller must say "open the job first", never present `href` as
   * being the page. */
  insideOneJob: boolean;
  title: string;
  steps: { title: string; body: string }[];
};

/**
 * The walkthroughs that answer `topic`, best match first. Ties keep the
 * registry's own order, which is why `.sort` here is over a decorated copy
 * rather than the array itself — `Array#sort` is stable, so ties fall back
 * to WALKTHROUGHS' order rather than whatever order the sort happens to
 * leave them in.
 *
 * Takes the CANDIDATE list as a parameter — callers pass the
 * capability-filtered list from `reachableWalkthroughs`, never the raw
 * registry, so a page nobody offered this person is never even scored.
 * Defaults to the full registry only so the index itself is testable
 * without a principal.
 */
export function searchAppHelp(
  topic: string,
  candidates: readonly Walkthrough[] = WALKTHROUGHS,
): AppHelpMatch[] {
  const terms = queryTerms(topic);
  if (terms.length === 0) return [];
  return candidates
    .map((walkthrough) => {
      const scores = termScores(walkthrough, terms);
      return { walkthrough, relevant: isRelevant(scores), points: scores.reduce((a, b) => a + b, 0) };
    })
    .filter((entry) => entry.relevant)
    .sort((a, b) => b.points - a.points)
    .map((entry) => ({
      route: entry.walkthrough.route,
      ...openableFor(entry.walkthrough.route),
      title: entry.walkthrough.title,
      steps: entry.walkthrough.steps.map((step) => ({ title: step.title, body: step.body })),
    }));
}

/**
 * The `href`/`insideOneJob` half of a match: a place that resolves, and
 * whether it is the page or only the way to it.
 *
 * A pattern with no openable prefix at all (`/[slug]`) falls back to
 * `/dashboard` — a real page, never `""`, which would render as a link to
 * the site root. No route in the registry is that shape, and
 * `appHelpRouteCensus.test.ts` fails the build if one appears: every
 * dynamic route today is a job page, which is the only thing that makes
 * the name `insideOneJob` a description rather than a lie.
 */
function openableFor(route: string): { href: string; insideOneJob: boolean } {
  if (isOpenableRoute(route)) return { href: route, insideOneJob: false };
  return { href: openableStartFor(route) ?? "/dashboard", insideOneJob: true };
}

/**
 * Which walkthroughs THIS person could actually open — the same rule
 * `canReach` states for the nav, applied to help content instead of a
 * link: a page a person cannot reach must never be named as the answer to
 * "how do I", because naming it teaches a step they will hit a refusal
 * page trying to follow.
 *
 * `capabilityForRoute` already returns null for a dynamic route
 * (`/jobs/[id]`) and for anything absent from ROUTE_CAPABILITY, which is
 * this function's only source of truth — the same one every other guard
 * in this codebase reads, so a page reachable here and refused by
 * `requireCapability` cannot happen without ROUTE_CAPABILITY itself
 * disagreeing with the page.
 */
export function reachableWalkthroughs(
  principal: Principal,
  walkthroughs: readonly Walkthrough[] = WALKTHROUGHS,
): Walkthrough[] {
  return walkthroughs.filter((walkthrough) => {
    const needed = capabilityForRoute(walkthrough.route);
    return needed === null || can(principal, needed);
  });
}
