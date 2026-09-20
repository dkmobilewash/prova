/**
 * The three onboarding questions and what they mean for the nav.
 *
 * Pure: answers in, a readable line or a hide/show decision out. No
 * database, no session — testable without a browser, same shape as
 * lib/permissions.ts and lib/getting-started.ts.
 *
 * THIS IS A DISPLAY PREFERENCE, NEVER A SECURITY BOUNDARY. Nothing here
 * touches `ROUTE_CAPABILITY`, `capabilitiesFor()` or any function in
 * lib/permissions.ts — that map decides what a PERSON may do, this module
 * decides what a COMPANY's rail bothers to show. A route this file hides is
 * still reachable by direct URL, still returned by global search
 * (lib/search/query.ts gates on capability only — see its own file
 * comment), and still explained by Ask (lib/ask/appHelp.ts, same). Hiding a
 * link hides nothing; it only stops the rail advertising a page most
 * companies of this shape never open.
 *
 * WHY A SIX-PERSON PLASTER CONTRACTOR SEES THIS AT ALL: the founder's own
 * words were that some businesses are "way too simple for this type of
 * software," and the sidebar answering questions nobody asked is what a
 * one-star review looks like at four seconds. Global search (#386) and Ask
 * being able to reach and explain every feature (lib/ask/appHelp.ts) are
 * what make cutting the visible surface safe rather than lossy — see both
 * files before changing either side of this.
 */

import type { Principal } from "@/lib/permissions";

export const CONTRACTING_RELATIONSHIPS = ["UNDER_GENERAL_CONTRACTORS", "DIRECT_FOR_OWNERS", "BOTH"] as const;
export type ContractingRelationship = (typeof CONTRACTING_RELATIONSHIPS)[number];

/** The three answers, exactly as stored on `Company`. Every field nullable,
 * and null is a first-class value meaning "not answered" — never coerced to
 * a default, because the whole point of this feature is that absence means
 * "show everything," not "assume the smallest company." */
export type BusinessScopeAnswers = {
  contractingRelationship: ContractingRelationship | null;
  doesPublicWork: boolean | null;
  filesMonthlyPayApps: boolean | null;
};

export const UNANSWERED_SCOPE: BusinessScopeAnswers = {
  contractingRelationship: null,
  doesPublicWork: null,
  filesMonthlyPayApps: null,
};

/**
 * True when nothing has been answered — the state of every company that
 * existed before this feature shipped, and of any company that clicked
 * "Skip" on the onboarding prompt. The nav filter below and the profile
 * line both short-circuit on this, which is what makes "existing companies
 * see everything" and "skipping shows everything" the same one rule rather
 * than two behaviours that could drift apart.
 */
export function hasNoScopeAnswers(answers: BusinessScopeAnswers): boolean {
  return (
    answers.contractingRelationship === null &&
    answers.doesPublicWork === null &&
    answers.filesMonthlyPayApps === null
  );
}

/**
 * Which nav routes each answer says to hide, and ONLY to hide — nothing in
 * this file ever grants a route access it did not already have.
 *
 * Deliberately short. The task names five things these answers "hang off":
 * retainage, certified payroll, prevailing wage, submittals and pay
 * applications. Prevailing wage and submittals are top-level routes in
 * `components/navItems.tsx` and are listed below. Certified payroll's
 * company-wide surface is `/union-compliance` ("Union & fringe" — apprentice
 * ratios and fringe remittance, which bite on the same public/prevailing-wage
 * jobs), also listed below. Retainage and pay applications have NO top-level
 * route at all as of the eight-tab job page (#385) — they are tabs inside
 * `app/(app)/jobs/[id]/**`, which is Diego's lane and out of scope for this
 * file. `filesMonthlyPayApps` is still collected and still drives the
 * profile line below; it has nothing to hide here until that lane wires a
 * gate into its own tabs.
 *
 * A route absent from this map is never hidden by any answer — the default
 * for everything this file does not name is "always show it."
 */
const ROUTE_HIDDEN_WHEN: Record<string, (answers: BusinessScopeAnswers) => boolean> = {
  // Submittals are correspondence TO THE GC — the page's own comments say
  // so ("the GC had blown a...") and the "Paper trail" group heading in
  // navItems.tsx says so too. Hidden only when the company said it never
  // works under a GC at all; BOTH keeps it, since some of their jobs do.
  "/submittals": (a) => a.contractingRelationship === "DIRECT_FOR_OWNERS",
  // Prevailing-wage rules and the union/apprentice/fringe reporting that
  // rides with certified-payroll work only bite on public jobs.
  "/prevailing-wage": (a) => a.doesPublicWork === false,
  "/union-compliance": (a) => a.doesPublicWork === false,
};

/**
 * Whether `href` should be hidden from the rail for this company's answers.
 *
 * `hasNoScopeAnswers` short-circuits to "never hide" before consulting the
 * map at all — a company with no opinion gets no hiding, full stop. That is
 * the regression this feature must never cause: it is checked directly in
 * businessScope.test.ts and again in navItems.test.ts against a company
 * with every field null.
 */
export function isHiddenByBusinessScope(href: string, answers: BusinessScopeAnswers): boolean {
  if (hasNoScopeAnswers(answers)) return false;
  return ROUTE_HIDDEN_WHEN[href]?.(answers) ?? false;
}

/**
 * The one readable line Settings and the onboarding prompt both show —
 * "Set up for: subcontractor under GCs, public works." Never a mystery
 * algorithm: every clause here is one of the three answers, worded the same
 * way the question asked it, and the settings page shows the three answers
 * themselves right next to it so nothing here is unaccountable.
 *
 * Null when nothing has been answered — no line beats a fabricated one, and
 * the caller is expected to render nothing (or its own "not set up yet")
 * rather than pass an empty answers object through and print "Set up for:"
 * with nothing after the colon.
 *
 * Deliberately additive-only in what it prints: an affirmative answer adds
 * a clause, a negative or unanswered one adds nothing, so the line stays as
 * short as the example in the spec rather than spelling out every "no."
 * The full three answers — including the "no"s — are still on screen, in
 * the same settings section, in the source fields this line was built from.
 */
export function businessScopeLine(answers: BusinessScopeAnswers): string | null {
  if (hasNoScopeAnswers(answers)) return null;

  const parts: string[] = [];

  if (answers.contractingRelationship === "UNDER_GENERAL_CONTRACTORS") parts.push("subcontractor under GCs");
  else if (answers.contractingRelationship === "DIRECT_FOR_OWNERS") parts.push("contracts direct for owners");
  else if (answers.contractingRelationship === "BOTH") parts.push("subcontractor under GCs and direct for owners");

  if (answers.doesPublicWork === true) parts.push("public works");
  if (answers.filesMonthlyPayApps === true) parts.push("monthly pay applications");

  if (parts.length === 0) return null;
  return `Set up for: ${parts.join(", ")}.`;
}

/** Whether this viewer may change the company's answers — owner only, same
 * rule as `updateCompanyProfile` in lib/actions/company.ts, because these
 * are company-wide settings and a member changing what the whole company's
 * nav shows is the same shape of decision as renaming the company. */
export function canEditBusinessScope(user: Pick<Principal, "role">): boolean {
  return user.role === "OWNER";
}

/** The exact wording of the three onboarding questions — the deliverable is
 * the wording, so it lives in one place both the prompt and Settings read
 * from, rather than being retyped in a component and drifting. Question 3
 * is asked in the words a contractor who has never heard the term "AIA
 * G702" would still recognise — that is the whole point of it, see the
 * issue this shipped from. */
export const BUSINESS_SCOPE_QUESTIONS = {
  contractingRelationship: {
    prompt: "Do you work under general contractors, or direct for owners?",
    options: [
      { value: "UNDER_GENERAL_CONTRACTORS", label: "Under general contractors" },
      { value: "DIRECT_FOR_OWNERS", label: "Direct for owners" },
      { value: "BOTH", label: "Both, depending on the job" },
    ] as const,
  },
  doesPublicWork: {
    prompt: "Do you do public / prevailing-wage work?",
  },
  filesMonthlyPayApps: {
    prompt: "Does the GC make you fill in a form every month before they will pay you?",
  },
} as const;
