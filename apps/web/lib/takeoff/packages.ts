/**
 * ── WHICH PRICING PACKAGE A MEASURED QUANTITY BELONGS TO ──
 *
 * A GC's bid form asks for a base number, then alternates it may or may not
 * take. The estimator measures all of it off the same sheets — the base
 * partitions, then the Add Alternate 1 build-out on level 3 — and before this
 * there was nowhere to say which was which. `TakeoffMeasurement` carried one
 * free-text `label`, so forty traced runs for an alternate and four hundred for
 * the base were one undifferentiated list, and posting them put every foot into
 * the number sent to the GC.
 *
 * **A base bid carrying an alternate's quantities is high by exactly that
 * alternate**, which loses the job without anybody being able to see why. The
 * mirror error loses money: an alternate accepted and never measured.
 *
 * ── THE DEFAULT IS THE BASE, AND THAT IS THE WHOLE SAFETY ARGUMENT ──
 *
 * `packageLabel` is null for the base bid, so every measurement ever traced
 * before this column existed, and every one traced without thinking about it,
 * is in the number. The alternative — an untagged quantity sitting outside the
 * base until somebody claims it — would silently bid LOW, and a bid that is low
 * for a reason nobody recorded is the one failure this product cannot afford.
 *
 * Low and high are not symmetric: a high bid is lost work, a low bid is work
 * won at a loss and then built.
 *
 * ── WHY THIS IS NOT JOINED TO `BidLine` ──
 *
 * `bid-lines.prisma` already models a bid's alternates properly — signed
 * amounts, three-state `accepted`, kept out of the base total — and the obvious
 * move is to point a measurement at one. It cannot be done yet, and the obstacle
 * is structural rather than a decision anybody made:
 *
 *   `BidLine` hangs off `BidInvitation`. A `TakeoffPlan` hangs off a `Job`. The
 *   only link between them is `BidInvitation.wonJobId`, which exists AFTER the
 *   bid is won — and measuring happens before. So at the moment the estimator is
 *   tracing an alternate, the job has no reachable bid at all.
 *
 * So the label is TEXT on the takeoff side, matched exactly as typed, and the
 * estimate side is not structured by package. Said plainly rather than
 * half-built: the posted lines NAME their package in the description, which an
 * estimator can group and move, and nothing here claims the estimate knows.
 * Joining the two wants the invitation reachable from the job before award,
 * which is its own piece of work.
 */

/** What the base bid is called on screen, for a group that carries no label. */
export const BASE_PACKAGE = "Base bid";

/** A measurement, as much of one as this module needs. */
export type PackagedMeasurement = {
  id: string;
  packageLabel: string | null;
};

export type MeasurementPackage = {
  /** The label as typed, or null for the base bid. */
  label: string | null;
  /** What to call it on screen. */
  name: string;
  /** True for the group that goes into the number sent to the GC. */
  isBase: boolean;
  ids: string[];
};

/**
 * Group measurements by their pricing package.
 *
 * The base always comes FIRST and always exists, even empty — a sheet whose
 * every measurement is an alternate should still show a base group reading
 * nothing, because "the base bid has no quantities on this sheet" is a fact
 * worth seeing and an absent heading says nothing at all.
 *
 * Labels are grouped EXACTLY as typed, and deliberately not trimmed into each
 * other or matched case-insensitively. `bid-levelling.ts` made the same call
 * for the same reason — a typo showing as two headings is a problem somebody
 * fixes in a second, and two scopes silently merged into one is a wrong number
 * nobody can see. The one exception is whitespace-only, which is not a label
 * anybody meant to type and reads as the base.
 */
export function measurementPackages(
  measurements: readonly PackagedMeasurement[],
): MeasurementPackage[] {
  const base: string[] = [];
  const byLabel = new Map<string, string[]>();
  for (const m of measurements) {
    const label = m.packageLabel?.trim() ?? "";
    if (label === "") {
      base.push(m.id);
      continue;
    }
    const list = byLabel.get(label) ?? [];
    list.push(m.id);
    byLabel.set(label, list);
  }
  return [
    { label: null, name: BASE_PACKAGE, isBase: true, ids: base },
    ...[...byLabel.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, ids]) => ({ label, name: label, isBase: false, ids })),
  ];
}

export type PostCheck =
  | { ok: true; label: string | null; name: string; count: number }
  | { ok: false; reason: string };

/**
 * Check that a set of measurements about to be posted is all one package.
 *
 * ── WHY MIXING IS REFUSED RATHER THAN REPORTED ──
 *
 * Every other advisory in this product NAMES a problem and lets the estimator
 * proceed — `bid-responsiveness.ts` says so of itself, and `indirect-costs.ts`
 * refuses to nag. This one refuses, and the difference is what happens after
 * the press.
 *
 * Those advisories are about a number that is VISIBLY incomplete: a line with
 * no cost, a missing dumpster. Posting a mixed selection produces line items
 * that are individually correct and collectively a base bid with an alternate
 * folded into it — and once posted there is nothing on any line that says which
 * package it came from, so it cannot be undone by looking. A refusal costs one
 * press; the alternative costs the job.
 *
 * It is also cheap to satisfy, which is what makes refusing fair: the packages
 * are on screen beside the selection, and posting twice is the correct action.
 */
export function onePackageOnly(
  selected: readonly PackagedMeasurement[],
): PostCheck {
  if (selected.length === 0) {
    return { ok: false, reason: "Nothing is selected, so there is nothing to add to the estimate." };
  }
  const labels = new Set(selected.map((m) => m.packageLabel?.trim() ?? ""));
  if (labels.size > 1) {
    const named = [...labels]
      .map((l) => (l === "" ? BASE_PACKAGE : l))
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
    return {
      ok: false,
      reason:
        `This selection spans ${labels.size} pricing packages — ${named}. ` +
        `Posting them together would put the alternates' quantities into the base bid, ` +
        `which sends it out high by exactly that much. Add one package at a time.`,
    };
  }
  const label = [...labels][0];
  return {
    ok: true,
    label: label === "" ? null : label,
    name: label === "" ? BASE_PACKAGE : label,
    count: selected.length,
  };
}

/**
 * How a posted line says which package it came from.
 *
 * A PREFIX on the description, and nothing structural — see the module header
 * for why the estimate side is not keyed by package yet. It is a prefix rather
 * than a suffix so a sorted or truncated list still shows it, and the base bid
 * gets NO prefix at all: every line on an ordinary estimate would otherwise
 * carry a noise word, and a label that appears on everything is read by nobody.
 */
export function describeForPackage(description: string, label: string | null): string {
  const clean = label?.trim() ?? "";
  if (clean === "") return description;
  return `[${clean}] ${description}`;
}
