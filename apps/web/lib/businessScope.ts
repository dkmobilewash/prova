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
 * DELIBERATELY SHORT, AND THE SHORTNESS IS THE FINDING RATHER THAN A GAP.
 * Widening this map was audited route by route on 2026-09-28, against the
 * page and the Prisma model behind each one rather than against its label.
 * Almost the whole rail is the sub's OWN operations — its schedule, its
 * crews, its material, its money, its cards at the gate — and none of that
 * changes shape because of who signs the contract. What these answers can
 * honestly hide is the COUNTERPARTY-SHAPED routes: the ones whose records
 * exist only because somebody above you in the chain sent you paper.
 *
 * The bar each entry has to clear is not "uses it less". It is: a company
 * that answered this way would never use the page, and would be RELIEVED
 * not to see it. A wrongly hidden entry is worse than a visible one nobody
 * clicks, because it teaches a contractor that the product lacks a feature
 * it has — NAV-IA-AUDIT.md is 180 lines of what that costs, six built
 * features cut from the rail and four later restored, and its own verdict
 * on the last two: "Deferring a feature and lying about it are different
 * acts; only the first was decided." A route that does not clear the bar
 * stays visible and gets argued in a PR, not guessed at here.
 *
 * Routes weighed and DELIBERATELY LEFT OUT, recorded so the next person does
 * not re-derive them (the reasoning is the model's, not a hunch):
 *
 *   - `/rfis` — an Rfi is a dated question about a set of drawings and the
 *     answer that came back. Its only GC mention explains why numbers are
 *     never reissued. A company contracting direct for owners asks the
 *     architect the same questions and needs the same dated record to hang a
 *     change order on, so this is not GC-shaped, it is drawing-shaped.
 *   - `/drawings` — DrawingRevision's whole point is `receivedOn`: "when it
 *     actually reached us… a revision that exists and isn't in the trailer
 *     means the crew is building from paper that is already superseded."
 *     True of any job built from drawings, whoever issues them.
 *   - `/closeout` — the page is not only CloseoutSubmission (which does have
 *     a `gcResponse` column). It also holds WarrantyPeriod and
 *     WarrantyServiceRequest — callbacks — and a contractor working direct
 *     for owners gets those calls STRAIGHT from the owner rather than
 *     filtered through a GC. Hiding this would take away more than it saved.
 *   - `/proposals` — the clause library's own copy ties exclusions to "a
 *     GC's scope sheet", so if it leans anywhere it leans the other way, and
 *     exclusions are the spine of a bid to an owner too.
 *   - `/intake` — the tray files ten kinds. Four are subcontract paper
 *     (SUBMITTAL, RFI_RESPONSE, EXECUTED_SUBCONTRACT, PAY_APP) but
 *     DRAWING, COMPLIANCE_DOC, LIEN_WAIVER, CERTIFIED_PAYROLL and PHOTO are
 *     not, so it stays a generic document tray for everybody.
 *   - `/bids` — "Every bid invitation logged across every GC" reads
 *     GC-shaped, but the record is `BidInvitation.contactId`: whoever asked
 *     you to price it, owner or GC. It is a price-history table.
 *
 * `filesMonthlyPayApps` still hides NOTHING, and that is unchanged rather
 * than unexamined. Retainage and pay applications have no top-level route —
 * they are tabs inside `app/(app)/jobs/[id]/**`, Diego's lane. The answer is
 * collected, drives the profile line below and the Ask context, and has
 * nothing on this rail to key off.
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
  // A backcharge is a GC deducting from what it owes us under a subcontract,
  // and the MODEL says so rather than only the page: `gcReference` is "the
  // GC's own document number for it, which is what they will quote back at
  // us", `claimedAmount` is "what the GC says we owe", and `respondByDate`
  // is "the contractual deadline to object in writing… most subcontracts
  // state one". The page's first line is "Money the GC is taking off what
  // they owe us". An unhappy OWNER simply withholds: there is no notice
  // with a number on it to log and no objection window to beat, so a
  // direct-for-owners company reads this label and cannot tell what it is
  // for. Same shape and same reasoning as /submittals above, so BOTH keeps
  // it for the same reason — some of their jobs are under a GC.
  "/backcharges": (a) => a.contractingRelationship === "DIRECT_FOR_OWNERS",
  // Prevailing-wage rules and the union/apprentice/fringe reporting that
  // rides with certified-payroll work only bite on public jobs.
  "/prevailing-wage": (a) => a.doesPublicWork === false,
  "/union-compliance": (a) => a.doesPublicWork === false,
};

/**
 * Every route this file could ever hide, whatever the answers.
 *
 * Exported so the data guard's probe list (lib/businessScopeData.ts) can be
 * checked against it from BOTH ends — a probe for a route that is not
 * hideable is dead code, and a hideable route with no probe is a route the
 * guard silently cannot protect. `businessScopeData.test.ts` fails the build
 * on either. Per CLAUDE.md's census scars, that is a set asserted against a
 * source that cannot drift with it rather than a count somebody maintains.
 */
export const HIDEABLE_ROUTES: readonly string[] = Object.keys(ROUTE_HIDDEN_WHEN);

/**
 * Which routes these answers WOULD hide, before the data guard has its say.
 *
 * Pure, and the reason it is exported is cost. The caller has to ask the
 * database whether this company already has rows behind a route it is about
 * to hide, and the cheapest version of that question is not asking it: a
 * company with no answers, or with answers that happen to hide nothing,
 * needs no query at all. `app/(app)/layout.tsx` calls this first and only
 * reaches for `loadRoutesWithData` when the list is non-empty.
 */
export function routesHiddenByAnswers(answers: BusinessScopeAnswers): string[] {
  if (hasNoScopeAnswers(answers)) return [];
  return HIDEABLE_ROUTES.filter((href) => ROUTE_HIDDEN_WHEN[href]?.(answers) ?? false);
}

/**
 * Whether `href` should be hidden from the rail for this company's answers.
 *
 * `hasNoScopeAnswers` short-circuits to "never hide" before consulting the
 * map at all — a company with no opinion gets no hiding, full stop. That is
 * the regression this feature must never cause: it is checked directly in
 * businessScope.test.ts and again in navItems.test.ts against a company
 * with every field null.
 *
 * `routesWithData` IS THE SECOND THING THAT OVERRIDES AN ANSWER, and it
 * matters more than it reads. An answer is a statement about the work a
 * company intends to take; the rows in its database are a statement about
 * the work it has already done, and when the two disagree the rows win.
 * A company that has logged backcharges under a GC and later answers
 * "direct for owners" must not lose the door to the dispute deadlines it
 * is still inside of — the amounts keep feeding the job's money either
 * way, so hiding the menu would leave a figure on screen with no way to
 * reach what it is made of. Same for a union shop that answers "no public
 * work": the fringe it owes the trust funds this month does not stop being
 * owed because the next job is private.
 *
 * Deliberately a LIST OF ROUTES rather than a count, a flag or a company
 * id: this module stays pure (no Prisma, no session, no I/O — see the file
 * header), so the caller gathers the facts and hands them over as data.
 * lib/businessScopeData.ts is the only half that knows any table names.
 * Omitted, it means "nothing known to have data", which is the honest
 * default for every caller that has not asked — the answers then decide
 * alone, exactly as they did before this guard existed.
 */
export function isHiddenByBusinessScope(
  href: string,
  answers: BusinessScopeAnswers,
  routesWithData: readonly string[] = [],
): boolean {
  if (hasNoScopeAnswers(answers)) return false;
  if (routesWithData.includes(href)) return false;
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
