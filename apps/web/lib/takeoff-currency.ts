/**
 * Whether the paper you measured is still the current paper.
 *
 * An estimator traces a floor plan, gets 1,240 LF of partition, and posts it
 * to the estimate. Three days later Addendum 3 lands and moves a corridor.
 * The 1,240 is now a number produced from superseded drawings, and nothing in
 * the app knows — the measurement, the line item and the bid all look exactly
 * as they did.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS NAMES WHAT IS SUSPECT. IT NEVER RE-MEASURES AND NEVER RE-SCALES.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The obvious feature here is "re-quantify automatically", and it is not
 * buildable and should not be faked. The app cannot see what moved on the new
 * sheet — it has no PDF comparison, and a corridor shifting two feet changes
 * a length by an amount only a person looking at both drawings can know.
 * Anything this file computed as a NEW quantity would be a guess wearing the
 * shape of a measurement, printed next to real ones.
 *
 * So the whole output is a list of what to go and look at, and the strongest
 * thing it ever says is "this was measured off Rev 2; Rev 3 has since been
 * issued."
 *
 * WHY DATES AND LABELS RATHER THAN A RELATION. `takeoff.prisma` says
 * `TakeoffPlan` "must not become" `DrawingSet`/`DrawingRevision` — those are
 * the job's paper trail, this is a sheet somebody was emailed with an
 * invitation to bid, and at bid time the job usually has no drawing set at
 * all. Joining them would collapse that boundary and would not work anyway.
 * `DrawingRevision` refuses a counter for the same underlying reason: the
 * labels belong to the architect, printed on a title block nobody here
 * controls.
 *
 * UNKNOWABLE IS A FIRST-CLASS ANSWER, the posture `bid-outcome.ts` takes
 * toward unfinished jobs. A plan with no issue date recorded cannot be shown
 * to be superseded — and cannot be shown to be current either. Calling it
 * current would be the dangerous half of that guess, so it is neither.
 *
 * Pure. No database, no React.
 */

export type CurrencyState = "CURRENT" | "SUPERSEDED" | "UNKNOWABLE";

/** A plan somebody measured off. */
export type MeasuredPlan = {
  id: string;
  fileName: string | null;
  /** As printed on the title block — "Rev 2". Never parsed for ordering. */
  revisionLabel: string | null;
  /** The date ON the sheet, entered. Null is the common, honest case. */
  sheetIssuedOn: string | null;
  /** How many measurements were taken off it. Nothing here re-measures them;
   * the count is what makes the warning worth reading. */
  measurementCount: number;
};

/** A later issue of the drawings, from the job's own paper trail. */
export type IssuedRevision = {
  id: string;
  /** "Rev 3", "ASI-12" — the architect's label. */
  label: string;
  setName: string;
  issuedOn: string;
  description: string | null;
};

/** An addendum on a bid, flagged as changing work already priced. */
export type PricedScopeAddendum = {
  id: string;
  reference: string;
  issuedOn: string | null;
  impactNote: string | null;
};

export type SupersededBy = {
  kind: "REVISION" | "ADDENDUM";
  label: string;
  issuedOn: string;
  note: string | null;
};

export type PlanCurrency = {
  planId: string;
  state: CurrencyState;
  /** Everything issued after this plan's sheet, newest first. Empty unless
   * SUPERSEDED. */
  supersededBy: SupersededBy[];
  /** What the screen says, in full. Never null — there is always something
   * worth saying, including "nothing has been issued since". */
  sentence: string;
};

const describe = (plan: MeasuredPlan) =>
  plan.revisionLabel?.trim() || plan.fileName?.trim() || "this sheet";

const quantities = (count: number) =>
  `${count} measurement${count === 1 ? "" : "s"}`;

/** "a, b and c" — the form the rest of the app's prose uses. */
function listOf(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Whether one measured plan is still current.
 *
 * Compares DATES. A revision or addendum issued strictly after the sheet's
 * own issue date supersedes it; one issued on the SAME day does not, because
 * a sheet and its own transmittal routinely share a date and calling that
 * superseded would cry wolf on every plan.
 */
export function planCurrency(
  plan: MeasuredPlan,
  revisions: IssuedRevision[],
  addenda: PricedScopeAddendum[],
): PlanCurrency {
  if (!plan.sheetIssuedOn) {
    return {
      planId: plan.id,
      state: "UNKNOWABLE",
      supersededBy: [],
      sentence: `No issue date recorded for ${describe(plan)}, so nothing here can tell whether ${quantities(plan.measurementCount)} came off current drawings. Put the date from the title block on it.`,
    };
  }

  const after: SupersededBy[] = [
    ...revisions
      .filter((revision) => revision.issuedOn > plan.sheetIssuedOn!)
      .map((revision): SupersededBy => ({
        kind: "REVISION",
        label: `${revision.setName} ${revision.label}`.trim(),
        issuedOn: revision.issuedOn,
        note: revision.description,
      })),
    // An addendum with no issue date cannot be placed in time, so it cannot
    // supersede anything. It is not silently dropped — `undatedAddenda`
    // reports it separately.
    ...addenda
      .filter((addendum) => addendum.issuedOn !== null && addendum.issuedOn > plan.sheetIssuedOn!)
      .map((addendum): SupersededBy => ({
        kind: "ADDENDUM",
        label: addendum.reference,
        issuedOn: addendum.issuedOn as string,
        note: addendum.impactNote,
      })),
  ].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));

  if (after.length === 0) {
    return {
      planId: plan.id,
      state: "CURRENT",
      supersededBy: [],
      sentence: `Nothing has been issued since ${describe(plan)} (${plan.sheetIssuedOn}).`,
    };
  }

  return {
    planId: plan.id,
    state: "SUPERSEDED",
    supersededBy: after,
    sentence: `${quantities(plan.measurementCount)} came off ${describe(plan)}, issued ${plan.sheetIssuedOn}. ${listOf(after.map((item) => `${item.label} (${item.issuedOn})`))} ${after.length === 1 ? "has" : "have"} been issued since. Go and check what moved — nothing here re-measures anything.`,
  };
}

/**
 * Addenda that say they changed priced work but carry no issue date.
 *
 * Reported separately rather than folded into any plan's verdict: an
 * undated addendum cannot be placed in time, so it cannot be said to
 * supersede a sheet — and cannot be said not to. Dropping it silently is the
 * one option that would be wrong.
 */
export function undatedAddenda(addenda: PricedScopeAddendum[]): string[] {
  return addenda.filter((addendum) => addendum.issuedOn === null).map((addendum) => addendum.reference);
}

export type TakeoffCurrency = {
  plans: PlanCurrency[];
  supersededCount: number;
  unknowableCount: number;
  /** Measurements sitting on superseded paper. The number that makes this
   * worth a banner rather than a line. */
  measurementsAtRisk: number;
  /** The banner sentence, or null when every plan is current and dated. */
  headline: string | null;
};

/** Every measured plan on a job, judged. */
export function takeoffCurrency(
  plans: MeasuredPlan[],
  revisions: IssuedRevision[],
  addenda: PricedScopeAddendum[],
): TakeoffCurrency {
  const judged = plans.map((plan) => planCurrency(plan, revisions, addenda));
  const superseded = judged.filter((plan) => plan.state === "SUPERSEDED");
  const unknowable = judged.filter((plan) => plan.state === "UNKNOWABLE");
  const measurementsAtRisk = superseded.reduce((sum, plan) => {
    const source = plans.find((candidate) => candidate.id === plan.planId);
    return sum + (source?.measurementCount ?? 0);
  }, 0);

  return {
    plans: judged,
    supersededCount: superseded.length,
    unknowableCount: unknowable.length,
    measurementsAtRisk,
    headline:
      superseded.length > 0
        ? `${quantities(measurementsAtRisk)} on this job came off drawings that have since been superseded. Nothing has been re-measured — check what moved.`
        : unknowable.length > 0
          ? `${unknowable.length} plan${unknowable.length === 1 ? "" : "s"} here ${unknowable.length === 1 ? "has" : "have"} no issue date, so nothing can tell whether ${unknowable.length === 1 ? "its" : "their"} measurements came off current drawings.`
          : null,
  };
}
