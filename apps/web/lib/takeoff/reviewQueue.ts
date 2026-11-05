/**
 * ── ONE REVIEW QUEUE FOR THE WHOLE JOB ──
 *
 * The job stepper's Review step opens this: everything a person still has to
 * decide before the takeoff is an estimate, one item at a time, in this order
 * (Diego's guided-flow Phase 4):
 *
 *   1. wall   — a run the model held off the estimate, "to confirm";
 *   2. type   — a found wall group posted to "Walls — untyped", which the
 *               "Set type" picker names (`setWallGroupType`), the type the
 *               drawing suggests offered first (`postingGate.ts`);
 *   3. scale  — a floor plan with no scale saved;
 *   4. price  — an estimate line with neither a price nor a cost.
 *
 * Built from rows that already exist, on every render, and never stored: an
 * item leaves the queue because the row behind it changed. Review is done
 * when the queue is empty (`job-steps.ts`).
 */
export type QueueRun = { x1: number; y1: number; x2: number; y2: number };
export type ReviewItem =
  | ({ kind: "wall"; key: string; pageNumber: number; sheet: string; measurementId: string; feet: number | null } & QueueRun)
  | { kind: "type"; key: string; pageNumber: number; sheet: string; inches: number; runs: QueueRun[]; feet: number | null; suggested: string | null }
  | { kind: "scale"; key: string; pageNumber: number; sheet: string }
  | { kind: "price"; key: string; lineItemId: string; description: string; quantity: string; unit: string | null };

const length = (run: QueueRun) => Math.hypot(run.x2 - run.x1, run.y2 - run.y1);
const feetOf = (runs: readonly QueueRun[], feetPerUnit: number | null) =>
  feetPerUnit === null ? null : runs.reduce((n, run) => n + length(run), 0) * feetPerUnit;

export type QueueSheet = { pageNumber: number; sheet: string; feetPerUnit: number | null };

/** A held run, as a queue item. */
export function wallItem(sheet: QueueSheet, m: { id: string; xs: readonly number[]; ys: readonly number[] }): ReviewItem | null {
  if (m.xs.length !== 2 || m.ys.length !== 2) return null;
  const run = { x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! };
  return { kind: "wall", key: `wall:${m.id}`, pageNumber: sheet.pageNumber, sheet: sheet.sheet, measurementId: m.id, feet: feetOf([run], sheet.feetPerUnit), ...run };
}

/**
 * One sheet's untyped walls, grouped by the detection group each run came from
 * — that group's thickness is what "Set type" remembers on the item. A run on
 * "Walls — untyped" that no stored group holds (drawn by hand) is left to the
 * estimate line it is already on.
 */
export function typeItems(
  sheet: QueueSheet,
  untyped: readonly { xs: readonly number[]; ys: readonly number[] }[],
  groups: readonly { id: string; inches: number; runs: readonly QueueRun[]; suggested?: string | null }[],
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const group of groups) {
    if (!(group.inches > 0)) continue;
    const runs = group.runs.filter((run) =>
      untyped.some((m) => m.xs.length === 2 && m.xs[0] === run.x1 && m.xs[1] === run.x2 && m.ys[0] === run.y1 && m.ys[1] === run.y2),
    ).map((run) => ({ x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2 }));
    if (runs.length === 0) continue;
    out.push({ kind: "type", key: `type:${sheet.pageNumber}:${group.id}`, pageNumber: sheet.pageNumber, sheet: sheet.sheet, inches: group.inches, runs, feet: feetOf(runs, sheet.feetPerUnit), suggested: group.suggested ?? null });
  }
  return out;
}

const KIND_ORDER: ReviewItem["kind"][] = ["wall", "type", "scale", "price"];

/** The queue in the order a person meets it: by kind, then sheet, longest first. Prices keep the estimate's order. */
export function reviewQueue(items: readonly ReviewItem[]): ReviewItem[] {
  const page = (item: ReviewItem) => ("pageNumber" in item ? item.pageNumber : 0);
  const feet = (item: ReviewItem) => ("feet" in item ? (item.feet ?? 0) : 0);
  return items
    .map((item, at) => ({ item, at }))
    .sort((a, b) => KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) || page(a.item) - page(b.item) || feet(b.item) - feet(a.item) || a.at - b.at)
    .map(({ item }) => item);
}

/** The run to zoom to: a held run itself, or a group's longest run. */
export function focusOf(item: ReviewItem): (QueueRun & { pageNumber: number }) | null {
  if (item.kind === "wall") return { pageNumber: item.pageNumber, x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 };
  if (item.kind === "type") {
    const longest = item.runs.reduce((best, run) => (length(run) > length(best) ? run : best));
    return { pageNumber: item.pageNumber, ...longest };
  }
  return null;
}

/** What the stepper's Next says for a queue of `n`. */
export function reviewLabel(n: number): string {
  return `Review ${n} ${n === 1 ? "item" : "items"}`;
}

/** The legend's codes with the drawing's suggestion first; a suggestion the legend lacks is still offered. */
export function orderedCodes(codes: readonly string[], suggested: string | null): string[] {
  if (suggested === null) return [...codes];
  return [suggested, ...codes.filter((code) => code.toUpperCase() !== suggested.toUpperCase())];
}
