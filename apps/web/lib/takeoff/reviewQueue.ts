import { ceilingOption, type CeilingRoom, type HeightOption } from "./wallHeight";
import { verdictFor, type WallGroup } from "./wallGroups";
import { isPropagatedTag, plainTag } from "./planTextTags";
import { inchLabel } from "./wallVectors";

/**
 * ── ONE REVIEW QUEUE FOR THE WHOLE JOB ──
 *
 * The job stepper's Review step opens this: everything a person still has to
 * decide before the takeoff is an estimate, one item at a time, in this order
 * (Diego's guided-flow Phase 4):
 *
 *   1. wall   — a run the model held off the estimate, "to confirm";
 *   2. type   — a found wall group posted to "Walls — untyped", which the
 *               "Set type" picker names (`setWallGroupType`);
 *   3. height — a wall group (its takeoff item) with no height, which "Set
 *               height" gives one (`setWallGroupHeight`, `wallHeight.ts`);
 *   4. scale  — a floor plan with no scale saved;
 *   5. price  — an estimate line with neither a price nor a cost.
 *
 * Built from rows that already exist, on every render, and never stored: an
 * item leaves the queue because the row behind it changed. Review is done
 * when the queue is empty (`job-steps.ts`).
 */
export type QueueRun = { x1: number; y1: number; x2: number; y2: number };
/** A pre-filled answer and where it came from, in words: `tag S6B on A101`. */
export type Guess = { code: string; from: string };
/** A type's height for the queue, by code: the job's item height, else its legend height. */
export type CodeHeight = { feet: number; from: string };
export type ReviewItem =
  | ({ kind: "wall"; key: string; pageNumber: number; sheet: string; measurementId: string; feet: number | null } & QueueRun)
  | {
      kind: "type";
      key: string;
      pageNumber: number;
      sheet: string;
      inches: number;
      runs: QueueRun[];
      feet: number | null;
      /** The type the drawing suggests and where that came from, pre-filled for Enter. */
      suggested: Guess | null;
      /** The ceiling over the rooms its walls bound, the height when its type has none. */
      ceiling: HeightOption | null;
    }
  | { kind: "height"; key: string; itemId: string; name: string; pageNumber: number; sheet: string; runs: QueueRun[]; feet: number | null; options: HeightOption[] }
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
  groups: readonly { id: string; inches: number; runs: readonly QueueRun[]; suggested?: Guess | null; rooms?: readonly CeilingRoom[] }[],
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const group of groups) {
    if (!(group.inches > 0)) continue;
    const runs = group.runs.filter((run) =>
      untyped.some((m) => m.xs.length === 2 && m.xs[0] === run.x1 && m.xs[1] === run.x2 && m.ys[0] === run.y1 && m.ys[1] === run.y2),
    ).map((run) => ({ x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2 }));
    if (runs.length === 0) continue;
    out.push({
      kind: "type",
      key: `type:${sheet.pageNumber}:${group.id}`,
      pageNumber: sheet.pageNumber,
      sheet: sheet.sheet,
      inches: group.inches,
      runs,
      feet: feetOf(runs, sheet.feetPerUnit),
      suggested: group.suggested ?? null,
      ceiling: ceilingOption(runs, group.rooms ?? []),
    });
  }
  return out;
}

/**
 * A wall item with no height, shown on the sheet holding most of its length.
 * Its Set height offers the ceiling over the rooms its walls bound there and
 * the type's legend height, where either exists.
 */
export function heightItem(
  item: { id: string; name: string },
  sheets: readonly { sheet: QueueSheet; runs: readonly QueueRun[]; rooms: readonly CeilingRoom[] }[],
  legend: HeightOption | null,
): ReviewItem | null {
  const on = sheets.filter((s) => s.runs.length > 0);
  if (on.length === 0) return null;
  const span = (runs: readonly QueueRun[]) => runs.reduce((n, run) => n + length(run), 0);
  const most = on.reduce((best, s) => ((feetOf(s.runs, s.sheet.feetPerUnit) ?? span(s.runs)) > (feetOf(best.runs, best.sheet.feetPerUnit) ?? span(best.runs)) ? s : best));
  const feet = on.every((s) => s.sheet.feetPerUnit === null) ? null : on.reduce((n, s) => n + (feetOf(s.runs, s.sheet.feetPerUnit) ?? 0), 0);
  const options = [ceilingOption(most.runs, most.rooms), legend].filter((o): o is HeightOption => o !== null);
  return { kind: "height", key: `height:${item.id}`, itemId: item.id, name: item.name, pageNumber: most.sheet.pageNumber, sheet: most.sheet.sheet, runs: [...most.runs], feet, options };
}

/**
 * The type the drawing suggests for an untyped group, and why, from the same
 * verdict the sheet's group list shows (`verdictFor`). A tag the library
 * lacks is suggested only where the set's legend defines it, since "Set
 * type" adds it from there. Nothing is suggested from a bare thickness shared
 * by several types: that is the question, not an answer.
 */
export function suggestType(group: WallGroup, sheet: string, legendCodes: readonly string[]): Guess | null {
  const verdict = verdictFor(group);
  const tagged = (tag: string) => (isPropagatedTag(tag) ? `tag ${plainTag(tag)} carried along the wall on ${sheet}` : `tag ${plainTag(tag)} on ${sheet}`);
  switch (verdict.state) {
    case "NAMED":
    case "TAG_DISAGREES":
      return { code: verdict.type.code, from: tagged(verdict.tag) };
    case "NO_SUCH_TYPE": {
      const code = legendCodes.find((c) => c.toUpperCase() === plainTag(verdict.tag).toUpperCase());
      return code === undefined ? null : { code, from: `${tagged(verdict.tag)}, from the legend` };
    }
    case "ONLY_ONE_THAT_THICK":
      return { code: verdict.type.code, from: `the only ${inchLabel(group.inches)} type in your library` };
    case "ASK":
      return verdict.suggested === undefined ? null : { code: verdict.suggested.code, from: verdict.note ? `sheet note: ${verdict.note}` : `first of the ${inchLabel(group.inches)} types` };
    default:
      return null;
  }
}

/** The height pre-filled for a type: its own (the job's item, else the legend's), else the ceiling. */
export function heightFor(code: string | null, heights: Readonly<Record<string, CodeHeight>>, ceiling: HeightOption | null): CodeHeight | null {
  const own = code === null ? undefined : heights[code.toUpperCase()];
  return own ?? (ceiling === null ? null : { feet: ceiling.feet, from: ceiling.from });
}

const KIND_ORDER: ReviewItem["kind"][] = ["wall", "type", "height", "scale", "price"];

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
  if (item.kind === "type" || item.kind === "height") {
    const longest = item.runs.reduce((best, run) => (length(run) > length(best) ? run : best));
    return { pageNumber: item.pageNumber, ...longest };
  }
  return null;
}

/** What the stepper's Next says for a queue of `n`. */
export function reviewLabel(n: number): string {
  return `Review ${n} ${n === 1 ? "item" : "items"}`;
}
