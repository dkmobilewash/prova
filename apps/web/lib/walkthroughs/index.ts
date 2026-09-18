import type { Walkthrough } from "./types";
import { alertsWalkthrough } from "./alerts";
import { backchargesWalkthrough } from "./backcharges";
import { bidsWalkthrough } from "./bids";
import { cashFlowWalkthrough } from "./cash-flow";
import { catalogWalkthrough } from "./catalog";
import { certificationsWalkthrough } from "./certifications";
import { closeoutWalkthrough } from "./closeout";
import { complianceWalkthrough } from "./compliance";
import { drawingsWalkthrough } from "./drawings";
import { equipmentWalkthrough } from "./equipment";
import { intakeWalkthrough } from "./intake";
import { lienDeadlinesWalkthrough } from "./lien-deadlines";
import { materialOrdersWalkthrough } from "./material-orders";
import { messagesWalkthrough } from "./messages";
import { askWalkthrough } from "./ask";
import { contactsWalkthrough } from "./contacts";
import { dashboardWalkthrough } from "./dashboard";
import { fieldReportsWalkthrough } from "./field-reports";
import { jobDetailWalkthrough } from "./job-detail";
import { newJobWalkthrough } from "./jobs-new";
import { pipelineWalkthrough } from "./pipeline";
import { punchListsWalkthrough } from "./punch-lists";
import { scheduleWalkthrough } from "./schedule";
import { settingsImportWalkthrough } from "./settings-import";
import { settingsIntegrationsWalkthrough } from "./settings-integrations";
import { deploymentWalkthrough } from "./deployment";
import { phaseCodesWalkthrough } from "./phase-codes";
import { photosWalkthrough } from "./photos";
import { prevailingWageWalkthrough } from "./prevailing-wage";
import { rfisWalkthrough } from "./rfis";
import { safetyWalkthrough } from "./safety";
import { settingsWalkthrough } from "./settings";
import { submittalsWalkthrough } from "./submittals";
import { teamWalkthrough } from "./team";
import { unionComplianceWalkthrough } from "./union-compliance";
import { vendorsWalkthrough } from "./vendors";
import { vendorPricingWalkthrough } from "./vendors-pricing";

export type { Walkthrough, WalkthroughStep } from "./types";

/**
 * Every "Walk me through this page" tour, one file per route.
 *
 * Adding a page is two edits and no conflicts: a new file beside these
 * with its steps, and one line here. Then put a `data-tour="…"` attribute
 * on each element a step points at, and take the route off
 * ROUTES_WITHOUT_WALKTHROUGH below. `walkthroughCensus.test.ts` fails the
 * build if a step points at an anchor its page does not render, if two
 * steps share one, or if the route has no page.
 */
export const WALKTHROUGHS: Walkthrough[] = [
  dashboardWalkthrough,
  newJobWalkthrough,
  jobDetailWalkthrough,
  scheduleWalkthrough,
  pipelineWalkthrough,
  contactsWalkthrough,
  punchListsWalkthrough,
  fieldReportsWalkthrough,
  askWalkthrough,
  settingsImportWalkthrough,
  settingsIntegrationsWalkthrough,
  alertsWalkthrough,
  backchargesWalkthrough,
  bidsWalkthrough,
  cashFlowWalkthrough,
  catalogWalkthrough,
  certificationsWalkthrough,
  closeoutWalkthrough,
  complianceWalkthrough,
  drawingsWalkthrough,
  equipmentWalkthrough,
  intakeWalkthrough,
  lienDeadlinesWalkthrough,
  materialOrdersWalkthrough,
  messagesWalkthrough,
  phaseCodesWalkthrough,
  photosWalkthrough,
  prevailingWageWalkthrough,
  rfisWalkthrough,
  safetyWalkthrough,
  settingsWalkthrough,
  submittalsWalkthrough,
  teamWalkthrough,
  unionComplianceWalkthrough,
  vendorsWalkthrough,
  vendorPricingWalkthrough,
  deploymentWalkthrough,
];

/**
 * Every page in the nav that has no walkthrough yet — the next wave's
 * checklist, kept here so coverage is visible rather than remembered.
 *
 * The census holds this list to the nav in both directions: a nav route
 * must be covered or listed here, and a route listed here must not also be
 * covered. So writing a walkthrough forces its line out of this list, and
 * adding a page to the nav forces a decision.
 *
 * `/jobs` and `/estimating` are not here because neither is a page: both
 * redirect to /dashboard, whose walkthrough covers the jobs list and the
 * Estimating filter.
 */
export const ROUTES_WITHOUT_WALKTHROUGH: string[] = [
  // C Stream's own operator page (who is still logging in, across every
  // customer). No customer can open it, so there is nobody to walk through it.
  "/internal/usage",
  // C Stream's own sales CRM, for selling C Stream. Operator-only like
  // /internal/usage: a customer sees "Not part of your access".
  "/sales",
];

/** True when `pathname` is an address of `route`. A `[segment]` in the
 * route matches any one non-empty path segment; everything else must match
 * exactly. No prefix matching — /settings/import is not /settings. */
export function routeMatches(route: string, pathname: string): boolean {
  const want = route.split("/").filter(Boolean);
  const have = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (want.length !== have.length) return false;
  return want.every((segment, i) => /^\[[^\]]+\]$/.test(segment) || segment === have[i]);
}

function isDynamic(route: string): boolean {
  return /\[[^\]]+\]/.test(route);
}

/**
 * The walkthrough for the page at `pathname`, or null.
 *
 * A route with no `[segment]` wins over one that has one, the same rule
 * Next.js routes by: /jobs/new is the new-job form, never a job whose id
 * happens to be "new". The census checks every static sibling of a dynamic
 * route resolves to its own page here, not to the dynamic one.
 */
export function walkthroughFor(
  pathname: string,
  walkthroughs: Walkthrough[] = WALKTHROUGHS,
): Walkthrough | null {
  const matches = walkthroughs.filter((w) => routeMatches(w.route, pathname));
  return matches.find((w) => !isDynamic(w.route)) ?? matches[0] ?? null;
}
