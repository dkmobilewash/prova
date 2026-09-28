/**
 * The database half of the business-scope nav filter: "does this company
 * ALREADY have rows behind a route its answers are about to hide?"
 *
 * WHY THIS IS A SEPARATE FILE. lib/businessScope.ts is pure by
 * construction — its own header says so, and components/navItems.tsx
 * (which runs in the browser) imports it. Putting a Prisma call in either
 * would drag the client into the server, so the split is the design: that
 * module decides, this one gathers, and the caller carries the answer
 * across as plain data. Nothing here is imported by a client component.
 *
 * WHY THE GUARD EXISTS AT ALL. An answer is a statement of intent; the rows
 * are a statement of fact, and when they disagree the rows win. A company
 * that spent a year under GCs, logged backcharges, and then answered
 * "direct for owners" must not lose the door to disputes it is still inside
 * of — the claimed amounts keep counting against the job's money whether
 * the rail links to them or not, so hiding the menu leaves a figure on
 * screen with nothing to open. Same for a union shop answering "no public
 * work" while it still owes the trust funds this month's fringe.
 *
 * DISPLAY ONLY, LIKE EVERYTHING IN THIS PAIR. Nothing here gates anything.
 * The worst a wrong answer from this file can do is show or hide a link;
 * the route renders either way, global search still finds it and Ask still
 * explains it.
 */

import { cache } from "react";
import { prisma } from "@prova/db";
import { HIDEABLE_ROUTES } from "./businessScope";

/**
 * For each route the answers can hide, the one table whose existence proves
 * this company has used it.
 *
 * ONE PROBE PER ROUTE, and it is the ROOT record rather than every table the
 * page touches — the page is the authority on which that is:
 *
 *   - `/submittals` → Submittal. The page is the log.
 *   - `/backcharges` → Backcharge. Same.
 *   - `/prevailing-wage` → PrevailingWageRuleSet. "There is no
 *     prevailing-wage dataset in this app and nothing here is seeded: every
 *     threshold is one you enter" — so a rule set is the only thing on that
 *     page a company can be said to have.
 *   - `/union-compliance` → UnionLocal. The page's own setup banner:
 *     "Nothing on this page can be worked out until the union local you work
 *     under is recorded… Every section below reads from it." No local means
 *     the page can compute nothing, so no local means no data.
 *
 * `businessScopeData.test.ts` holds this set to `HIDEABLE_ROUTES` from both
 * ends and checks every table and column against the Prisma schema files, so
 * a renamed model fails the build instead of throwing in the shell.
 */
export const ROUTE_DATA_PROBE: Record<string, { table: string; column: string }> = {
  "/submittals": { table: "Submittal", column: "companyId" },
  "/backcharges": { table: "Backcharge", column: "companyId" },
  "/prevailing-wage": { table: "PrevailingWageRuleSet", column: "companyId" },
  "/union-compliance": { table: "UnionLocal", column: "companyId" },
};

/** The routes in probe order, fixed once at module load so the SQL below and
 * the columns that come back cannot drift apart at runtime. */
const PROBED_ROUTES: readonly string[] = Object.keys(ROUTE_DATA_PROBE);

/**
 * ONE STATEMENT, ONE ROUND TRIP, ONE POOLED CONNECTION.
 *
 * That is the whole reason this is raw SQL rather than four
 * `findFirst`s in a `Promise.all`. `DATABASE_URL` carries
 * `connection_limit=5` (CLAUDE.md), the (app) layout already runs three
 * queries concurrently and the PAGE renders concurrently with the layout —
 * so four more parallel probes is four more pool slots at the exact moment
 * the pool is tightest, for a question that is four index probes wide.
 * `EXISTS` also stops at the first matching row instead of counting a
 * company's whole history of submittals to learn that it has one.
 *
 * Built ONCE, at module load, from the constant above — no request value
 * ever reaches the identifier list, and the only interpolated thing is `$1`,
 * a bound parameter. `$queryRawUnsafe` is needed because Prisma's tagged
 * template cannot place identifiers, not because anything unsafe is passed.
 * Aliases are positional (`p0`, `p1`) rather than the hrefs themselves, so a
 * route path can never have to survive being a SQL identifier.
 */
const PROBE_SQL = `SELECT ${PROBED_ROUTES.map((href, i) => {
  const { table, column } = ROUTE_DATA_PROBE[href];
  return `EXISTS (SELECT 1 FROM "${table}" WHERE "${column}" = $1) AS "p${i}"`;
}).join(", ")}`;

/** Exported for the census test, which reads the statement rather than
 * trusting that it was built from the probe table. */
export function probeSql(): string {
  return PROBE_SQL;
}

async function readRoutesWithData(companyId: string): Promise<string[]> {
  try {
    const [row] = await prisma.$queryRawUnsafe<Record<string, boolean>[]>(PROBE_SQL, companyId);
    if (!row) return [];
    return PROBED_ROUTES.filter((_href, i) => row[`p${i}`] === true);
  } catch (error) {
    // FAILING OPEN IS THE SAFE DIRECTION HERE, and it is the only direction
    // that matches the rest of this feature. Returning [] would mean "no
    // data anywhere", which hides every route the answers point at —
    // exactly the bug this guard exists to prevent, caused by the guard.
    // Claiming every route has data hides nothing, which is what a company
    // with no answers already gets (`hasNoScopeAnswers`) and what omitting
    // the argument already means. A rail with one extra entry on it costs
    // nobody anything.
    console.error(
      "[business-scope] the route-data probe failed; every hideable route is being shown rather than hidden.",
      error,
    );
    return [...PROBED_ROUTES];
  }
}

/**
 * The routes this company has rows behind, out of the ones its answers could
 * hide.
 *
 * ONE READ PER RENDER: React's `cache()` scopes the memo to a single server
 * request — same reasoning and same shape as `loadRetainageHeld` and
 * `loadEmployerBurdenRates` beside it — so the desktop rail and the mobile
 * drawer being fed from one layout costs one query, and outside a React
 * server render (tests, scripts) it calls straight through. Memoised on the
 * company id alone, which is a string, so the memo actually hits; the probe
 * list is a module constant rather than an argument for that reason.
 *
 * CALL IT ONLY WHEN SOMETHING WOULD BE HIDDEN. `routesHiddenByAnswers` is
 * pure and answers that for free, and for every company that skipped the
 * onboarding questions — which is every company that predates them — the
 * answer is "nothing", so the query never runs at all.
 */
export const loadRoutesWithData = cache(readRoutesWithData);

/** Kept honest against the pure module: the probe covers exactly the routes
 * that can be hidden. Read by the census test. */
export function probedRoutes(): readonly string[] {
  return PROBED_ROUTES;
}

/** The hideable routes with no probe behind them — always empty, and the
 * census test is what keeps it that way. Exported rather than asserted here
 * because a module that throws at import time takes the whole shell with
 * it, and an unprobed route is a build-time mistake, not a runtime one. */
export function unprobedHideableRoutes(): string[] {
  return HIDEABLE_ROUTES.filter((href) => !(href in ROUTE_DATA_PROBE));
}
