/**
 * THE GENERAL CONDITIONS THIS BID HAS NOTHING FOR.
 *
 * ── WHAT WAS ACTUALLY MISSING, WHICH IS NARROWER THAN IT SOUNDS ──
 *
 * The 2026-10-04 estimating audit listed indirect costs — supervision, permits,
 * mobilization, cleanup, safety gear — as a missing capability. The MECHANISM
 * was never missing: a `JobLineItem` with a cost and `unitPrice: null` has
 * priced general conditions correctly since #512, is in the cost base, receives
 * no share of the spread, and is recovered through the billable lines. Twelve
 * files repeat that rule and the GC portal has a test whose failure message is
 * "a cost-only budget line reached the GC's contract".
 *
 * What was missing is that **nothing could recognise one**. Every indirect was
 * `CostCategory.OTHER` with a free-text description, so no screen could tell
 * supervision from permits, so nothing could ever say "this bid has nothing for
 * cleanup". A forgotten $2,500 mobilization is money off the bottom line and no
 * surface said a word.
 *
 * `IndirectCostKind` makes them recognisable; this module is the only thing
 * that reads it and asks the question.
 *
 * ── IT NAMES WHAT IS ABSENT AND NOTHING ELSE ──
 *
 * No verdict, no tick, no refusal — the house rule, stated by
 * `bid-responsiveness.ts` ("there is no 'compliant' verdict in this file, and
 * that is deliberate"), `lien-waiver.ts` ("nothing here blocks a save"),
 * `addenda-overlap.ts` ("names, never concludes") and `bid-margin.ts` from #616.
 * A sub with no permits on a job must not be nagged into inventing one, and an
 * estimate is not incomplete because it is missing a dumpster.
 *
 * So the return is a list of ABSENT kinds and the company's own figure for each
 * where one exists. Pressing the button is the estimator's decision; the list
 * is only the question.
 *
 * ── PRESENT MEANS TAGGED, NOT GUESSED ──
 *
 * A line counts as covering a kind when it CARRIES that kind — either tagged by
 * hand or copied from a catalog entry that carries it. Nothing matches on a
 * description string, which is the rule `jobs.prisma` already states for
 * `costCategory`, `craftClassificationId` and `phaseCodeId`: classification is
 * declared, never inferred. A line called "Mobilization" that nobody tagged is
 * not mobilization as far as this module is concerned, and the estimator tags
 * it in one click rather than the app deciding for them.
 *
 * A tagged line with NO COST still counts as present. That is deliberate and it
 * is the difference between a checklist and a nag: an estimator who added a
 * cleanup line and left it at zero has decided cleanup is free on this job, and
 * saying "you have nothing for cleanup" after that is arguing with somebody who
 * already answered. `bid-margin.ts` separately reports a line with cost and no
 * price, which is where a zero belongs if it is an oversight.
 *
 * PURE. No database, no React, no clock. Derived on every read and never
 * stored — a stored "this bid has its indirects" is wrong the moment a line is
 * deleted.
 */

/** Kept in step with `IndirectCostKind` in `jobs.prisma` by the total `Record`
 *  below, which does not compile if the enum grows and this does not. */
export const INDIRECT_COST_KINDS = [
  "SUPERVISION",
  "MOBILIZATION",
  "PERMITS",
  "CLEANUP",
  "SAFETY",
  "TEMPORARY_PROTECTION",
  "DUMPSTERS",
  "CLOSEOUT",
] as const;

export type IndirectCostKindValue = (typeof INDIRECT_COST_KINDS)[number];

/**
 * What each one is called on screen and what it covers.
 *
 * A TOTAL `Record`, so a member added to the enum cannot reach a screen without
 * a label — the shape #526 landed for `CostCategory` after a missing member
 * produced a NaN bid total, and the reason `SPEC_FINDING_LABEL` is total too. A
 * raw `TEMPORARY_PROTECTION` on an estimate reads as a bug.
 *
 * NO AMOUNTS. What supervision costs is the company's own figure and lives on
 * its own catalog entry; a number here would be somebody else's guess printed
 * on a bid. `conceptual-estimate.ts` is the standing example of this app
 * refusing to originate a figure it has no basis for.
 */
export const INDIRECT_COST_LABEL: Record<IndirectCostKindValue, { label: string; covers: string }> = {
  SUPERVISION: { label: "Supervision", covers: "A foreman or super whose time is not on a measured line" },
  MOBILIZATION: { label: "Mobilization", covers: "Crew travel, first delivery, setting up" },
  PERMITS: { label: "Permits & testing", covers: "Permits, testing agencies, inspections" },
  CLEANUP: { label: "Cleanup", covers: "Daily clean, final clean, debris handling" },
  SAFETY: { label: "Safety", covers: "Harnesses, barricades, fall protection, the safety plan" },
  TEMPORARY_PROTECTION: { label: "Temporary protection", covers: "Poly, dust walls, floor protection" },
  DUMPSTERS: { label: "Dumpsters", covers: "Dumpsters and haul-off" },
  CLOSEOUT: { label: "Closeout", covers: "As-builts, O&M manuals, warranty letters" },
};

/** One line, as much of it as this question needs. */
export type IndirectLine = { indirectKind: string | null };

/** One of the company's catalog entries, if it has tagged any. */
export type IndirectCatalogEntry = {
  id: string;
  description: string;
  indirectKind: string | null;
  /** The company's own cost for it, or null if they catalogued it unpriced. */
  defaultBudgetedUnitCost: number | null;
};

export type MissingIndirect = {
  kind: IndirectCostKindValue;
  label: string;
  covers: string;
  /** The company's catalog entry for this kind, when they have one. Null means
   *  the press still adds a named line — with no cost, which is honest. */
  entry: IndirectCatalogEntry | null;
};

/**
 * Narrows a string to a kind this build knows.
 *
 * EXPORTED so the server action narrows against the same list rather than
 * casting. `setLineCostCategory` is the scar (#527): an unrecognised category
 * was silently coerced to null, which quietly CLEARED a line's cost type and
 * dropped it out of every markup with a success response. A kind that does not
 * narrow is an error here, never a blank.
 */
export function isIndirectCostKind(value: string | null): value is IndirectCostKindValue {
  return value !== null && (INDIRECT_COST_KINDS as readonly string[]).includes(value);
}

const isIndirectKind = isIndirectCostKind;

/**
 * The kinds this estimate has no line for, with the company's figure where
 * there is one.
 *
 * Returns them in `INDIRECT_COST_KINDS` order rather than by cost or by name:
 * declaration order is display order, the rule `bid-recap.ts` states for its own
 * markup steps, and a list that reorders itself as lines are added is one
 * nobody can scan twice.
 *
 * An entry the company has tagged but that is MISSING a cost is still offered —
 * it names the thing, and `bid-margin.ts` will report the costless line. Hiding
 * it would be the app deciding an untyped figure means "not needed".
 */
export function missingIndirects(
  lines: readonly IndirectLine[],
  catalogEntries: readonly IndirectCatalogEntry[],
): MissingIndirect[] {
  const present = new Set<string>();
  for (const line of lines) {
    if (isIndirectKind(line.indirectKind)) present.add(line.indirectKind);
  }

  const entryByKind = new Map<string, IndirectCatalogEntry>();
  for (const entry of catalogEntries) {
    // First one wins, and the order is the caller's. A company with two
    // supervision entries has a catalog to tidy, not a question for this
    // module — and picking "the cheapest" or "the newest" would be inventing a
    // rule nobody asked for.
    if (isIndirectKind(entry.indirectKind) && !entryByKind.has(entry.indirectKind)) {
      entryByKind.set(entry.indirectKind, entry);
    }
  }

  return INDIRECT_COST_KINDS.filter((kind) => !present.has(kind)).map((kind) => ({
    kind,
    label: INDIRECT_COST_LABEL[kind].label,
    covers: INDIRECT_COST_LABEL[kind].covers,
    entry: entryByKind.get(kind) ?? null,
  }));
}

/*
 * `missingIndirectsSentence` WAS HERE AND IS DELETED, 2026-10-04. It built
 * "This estimate carries nothing for Cleanup and Dumpsters." and NOTHING EVER
 * CALLED IT — `MissingIndirects.tsx` writes its own sentence, which is the one
 * on screen. Found by clicking the feature, not by any check here: the
 * function had its own passing unit tests, and a test on a pure function
 * proves the function works while saying nothing about anybody using it. The
 * "written, documented, and never called" shape CLAUDE.md names, with a test
 * suite on top of it.
 *
 * It is deleted rather than wired up, because the buttons below the sentence
 * already name every missing kind — so a sentence that also named them was
 * duplicating the list beside it, and two copies of one wording is the defect
 * `CostCategory` taught this repo to look for. The component's generic wording
 * plus the named buttons is the version that was always on screen and is the
 * better of the two.
 *
 * Recorded instead of quietly removed because the PR that shipped it claimed
 * the sentence named the kinds. It did not, and that claim is corrected in
 * `changelog.d/` rather than left for the next reader to trip over.
 */
