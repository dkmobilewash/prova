import type { CostCategoryValue } from "@/lib/bid-recap";
import { ceilingOption, type CeilingRoom, type HeightOption } from "./wallHeight";
import type { WallGroup } from "./wallGroups";
import { plainTag } from "./planTextTags";
import { SOURCE_WORDS, typeSource } from "./postingGate";
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
 *               "Set type" picker names (`setWallGroupType`), the type the
 *               drawing suggests pre-filled with its source (`postingGate.ts`);
 *   3. height — a wall group (its takeoff item) with no height, which "Set
 *               height" gives one (`setWallGroupHeight`, `wallHeight.ts`);
 *   4. windows — a sheet's windows counted by opening and typed by the nearest
 *               tag (`windowTags.ts`): one count to confirm, false hits
 *               dropped first (`confirmWindows`);
 *   5. scale  — a floor plan with no scale saved;
 *   6. price  — an estimate line with neither a price nor a cost. Once the
 *               company's own markup is set (`pricingRatesFor`) it asks for
 *               the line's COST and the price is worked from it
 *               (`priceLineFromCost`); before that, the estimate opens on the
 *               line for a price.
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
      /** The level its walls' plan shows, and that level's floor-to-floor for the types that run to the structure. */
      level?: QueueLevel;
    }
  | { kind: "height"; key: string; itemId: string; name: string; pageNumber: number; sheet: string; runs: QueueRun[]; feet: number | null; options: HeightOption[] }
  | {
      kind: "windows";
      key: string;
      pageNumber: number;
      sheet: string;
      /** Each counted window's frame line, lit on the plan; its type in `tags`, same order. */
      runs: QueueRun[];
      tags: string[];
      /** The window being looked at, zoomed to; null shows them all. */
      at: number | null;
    }
  | { kind: "scale"; key: string; pageNumber: number; sheet: string }
  | { kind: "price"; key: string; lineItemId: string; description: string; quantity: string; unit: string | null; askCost: boolean; costCategory: CostCategoryValue | null };

const length = (run: QueueRun) => Math.hypot(run.x2 - run.x1, run.y2 - run.y1);
const feetOf = (runs: readonly QueueRun[], feetPerUnit: number | null) =>
  feetPerUnit === null ? null : runs.reduce((n, run) => n + length(run), 0) * feetPerUnit;

/** "levels 2–9", its floor-to-floor and where that came from, and the codes it is the height of (those that run to the structure). */
export type QueueLevel = { label: string; height: CodeHeight | null; codes: string[] };

/** A type's height on a level: the level's floor-to-floor, for a type that runs to the structure. */
export function levelHeightFor(code: string | null, level: QueueLevel | undefined): CodeHeight | null {
  if (code === null || level === undefined || level.height === null) return null;
  return level.codes.includes(code.toUpperCase()) ? level.height : null;
}

/**
 * ── A GROUP SPLIT BY THE LEVEL ITS WALLS ARE DRAWN ON ──
 *
 * Diego, 2026-11-05: by level is automatic. Two plans on one sheet (Crosslines
 * A100: the 1st floor and floors 2–9) put one thickness group on two levels
 * with two floor-to-floors, so the group becomes one item per level, each
 * with its own height pre-filled. `levelsOf` gives each run its plan's levels.
 */
export function splitByLevel(
  item: Extract<ReviewItem, { kind: "type" }>,
  levelsOf: (runs: readonly QueueRun[]) => number[][],
  heightOf: (levels: readonly number[]) => CodeHeight | null,
  codes: readonly string[],
  feetPerUnit: number | null,
): ReviewItem[] {
  const levels = levelsOf(item.runs);
  const byLevel = new Map<string, { levels: number[]; runs: QueueRun[] }>();
  item.runs.forEach((run, i) => {
    const l = levels[i] ?? [];
    const key = l.join(",");
    byLevel.set(key, { levels: l, runs: [...(byLevel.get(key)?.runs ?? []), run] });
  });
  if (byLevel.size === 1 && [...byLevel.keys()][0] === "") return [item];
  return [...byLevel.values()].map(({ levels: l, runs }) => ({
    ...item,
    key: byLevel.size === 1 ? item.key : `${item.key}:L${l.join(",") || "-"}`,
    runs,
    feet: feetOf(runs, feetPerUnit),
    ...(l.length === 0 ? {} : { level: { label: l.length === 1 ? `level ${l[0]}` : `levels ${l[0]}–${l[l.length - 1]}`, height: heightOf(l), codes: [...codes] } }),
  }));
}

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
  /** The legend's height, and its options by part of the building (`legendOptions`). */
  legend: readonly HeightOption[],
): ReviewItem | null {
  const on = sheets.filter((s) => s.runs.length > 0);
  if (on.length === 0) return null;
  const span = (runs: readonly QueueRun[]) => runs.reduce((n, run) => n + length(run), 0);
  const most = on.reduce((best, s) => ((feetOf(s.runs, s.sheet.feetPerUnit) ?? span(s.runs)) > (feetOf(best.runs, best.sheet.feetPerUnit) ?? span(best.runs)) ? s : best));
  const feet = on.every((s) => s.sheet.feetPerUnit === null) ? null : on.reduce((n, s) => n + (feetOf(s.runs, s.sheet.feetPerUnit) ?? 0), 0);
  const options = [ceilingOption(most.runs, most.rooms), ...legend].filter((o): o is HeightOption => o !== null);
  return { kind: "height", key: `height:${item.id}`, itemId: item.id, name: item.name, pageNumber: most.sheet.pageNumber, sheet: most.sheet.sheet, runs: [...most.runs], feet, options };
}

/**
 * The type the drawing suggests for an untyped group, and why: #989's
 * `typeSource` (the same reading the whole-set run posts from, where its
 * source passes the gate), in `SOURCE_WORDS`, with the tag and the sheet.
 *
 *   printed tag: S6B on A101 · tag carried along the wall: S6B ·
 *   tag on another sheet of this floor: S6B · the only type that thick: 4-7/8"
 *
 * Beyond it, a tag the library lacks is suggested where the set's legend
 * defines it, since "Set type" adds it from there. A thickness several types
 * share suggests nothing: that is the question, not an answer.
 */
export function suggestType(group: WallGroup, sheet: string, legendCodes: readonly string[]): Guess | null {
  const tag = group.source.kind === "TAG" ? plainTag(group.source.tag) : null;
  const found = typeSource(group);
  if (found !== null) {
    const detail =
      found.source === "tag" || found.source === "tag-variant"
        ? `: ${tag} on ${sheet}`
        : found.source === "carried" || found.source === "sibling"
          ? `: ${tag}`
          : found.source === "thickness"
            ? `: ${inchLabel(group.inches)}`
            : "";
    return { code: found.type.code, from: `${SOURCE_WORDS[found.source]}${detail}` };
  }
  if (tag !== null && group.candidates.length === 0) {
    const code = legendCodes.find((c) => c.toUpperCase() === tag.toUpperCase());
    if (code !== undefined) return { code, from: `printed tag: ${tag} on ${sheet}, in the legend but not yet your library` };
  }
  return null;
}

/** The height pre-filled for a type: its own (the job's item, else the legend's), else the ceiling. */
export function heightFor(code: string | null, heights: Readonly<Record<string, CodeHeight>>, ceiling: HeightOption | null): CodeHeight | null {
  const own = code === null ? undefined : heights[code.toUpperCase()];
  return own ?? (ceiling === null ? null : { feet: ceiling.feet, from: ceiling.from });
}

const KIND_ORDER: ReviewItem["kind"][] = ["wall", "type", "height", "windows", "scale", "price"];

/** A sheet's suggested windows, until they are confirmed. */
export function windowsItem(sheet: QueueSheet, stored: { windows: readonly ({ tag: string } & QueueRun)[]; decided?: boolean }): ReviewItem | null {
  if (stored.decided === true || stored.windows.length === 0) return null;
  return {
    kind: "windows",
    key: `windows:${sheet.pageNumber}`,
    pageNumber: sheet.pageNumber,
    sheet: sheet.sheet,
    runs: stored.windows.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
    tags: stored.windows.map((w) => w.tag),
    at: null,
  };
}

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
  if (item.kind === "windows") return item.at === null || item.runs[item.at] === undefined ? null : { pageNumber: item.pageNumber, ...item.runs[item.at]! };
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

/** The legend's codes with the drawing's suggestion first; a suggestion the legend lacks is still offered. */
export function orderedCodes(codes: readonly string[], suggested: string | null): string[] {
  if (suggested === null) return [...codes];
  return [suggested, ...codes.filter((code) => code.toUpperCase() !== suggested.toUpperCase())];
}
