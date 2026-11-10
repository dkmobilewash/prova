import type { CostCategoryValue } from "@/lib/bid-recap";
import { variantLabel } from "./variantMark";
import { ceilingOption, heightOptionsInOrder, type CeilingRoom, type HeightOption } from "./wallHeight";
import type { WallGroup } from "./wallGroups";
import { plainTag } from "./planTextTags";
import { SOURCE_WORDS, typeSource } from "./postingGate";
import { inchLabel } from "./wallVectors";
import { familyOf } from "./wallTypeMatch";

/**
 * ── ONE REVIEW QUEUE FOR THE WHOLE JOB ──
 *
 * The job stepper's Review step opens this: everything a person still has to
 * decide before the takeoff is an estimate, one item at a time, in this order
 * (Diego's guided-flow Phase 4; groups ahead of held walls since Chrome's
 * re-test, as one key decides far more of the estimate there):
 *
 *   1. type   — a found wall group posted to "Walls — untyped", which the
 *               "Set type" picker names (`setWallGroupType`), the type the
 *               drawing suggests pre-filled with its source (`postingGate.ts`);
 *   2. height — a wall group (its takeoff item) with no height, which "Set
 *               height" gives one (`setWallGroupHeight`, `wallHeight.ts`);
 *   3. windows — a sheet's windows counted by opening and typed by the nearest
 *               tag (`windowTags.ts`): one count to confirm, false hits
 *               dropped first (`confirmWindows`);
 *   4. wall   — a run the model held off the estimate, "to confirm", sheet
 *               by sheet;
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
/** A suggested type and where it came from. `drawn`: read off the drawing — a printed tag or the legend — not a library guess by thickness, so "Accept all suggestions on this sheet" may take it. */
/** `variant`: the label for a code read off a marked tag, "C6 (C6* at tub/shower locations, see legend)" (`variantMark.ts`). */
/**
 * `match`: what makes two groups on different sheets the SAME drawn thing, for "Apply to
 * other floors" — the printed tag ("tag:C6") or the "unless noted" type ("note:C"). Absent
 * for a carried or sibling tag and for a thickness guess: those are never applied across sheets.
 */
export type Guess = { code: string; from: string; drawn?: true; variant?: string; match?: string };
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
      /** Where its sheet's plan names one building part: each type's height for that part (Bunkie's ADDITION 10'-0"), by code. */
      building?: { name: string; heights: Record<string, CodeHeight> };
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

/**
 * ── WHY A HEIGHT FROM THE DRAWINGS IS MISSING ──
 *
 * A wall type's height comes from the legend read (`legendHeightsFor`). With no
 * legend read on the set there is nothing to suggest from, and a queue offering
 * only the ceiling reads as if the drawings said nothing — Chrome on Baker,
 * 2026-11-06: "Ceiling 10'-0"" and no 15'-0" to deck. So the queue says why,
 * and where to fix it: read the legend, or have the owner turn the reading on.
 */
export type LegendState = "read" | "unread" | "off";
export function legendMissing(state: LegendState, jobId: string): { text: string; href: string; action: string } | null {
  if (state === "read") return null;
  return state === "unread"
    ? { text: "No height from the drawings: the wall legend has not been read yet.", href: `/jobs/${jobId}/takeoff`, action: "Read the wall legend" }
    : { text: "No height from the drawings: the wall legend has not been read, and Wall types from the drawings is off.", href: "/settings/assistant#ai-switch", action: "Turn it on (owner)" };
}

/** "levels 2–9", its floor-to-floor and where that came from, and the codes it is the height of (those that run to the structure). */
export type QueueLevel = { label: string; height: CodeHeight | null; codes: string[] };

/** A type's height on a level: the level's floor-to-floor, for a type that runs to the structure. */
export function levelHeightFor(code: string | null, level: QueueLevel | undefined): CodeHeight | null {
  if (code === null || level === undefined || level.height === null) return null;
  const family = familyOf(code, level.codes);
  return level.codes.includes(code.toUpperCase()) || family !== null ? level.height : null;
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

/**
 * ── A GROUP SPLIT BY THE ROOF OVER ITS WALLS (`roofParts.ts`) ──
 *
 * For a type that runs to the structure on a set whose sections print more than
 * one level: each wall takes the roof over the rooms either side of it — the
 * taller where they differ — and the group splits into the walls under a
 * pitched roof and those under a flat one, each offered its height with the
 * roof plan named. Walls with no room either side stay in the group as they
 * were. A group already split by level is left alone: one split per group.
 */
export function splitByRoof(
  item: Extract<ReviewItem, { kind: "type" }>,
  pitchedOf: (runs: readonly QueueRun[]) => (boolean | null)[],
  heights: { pitched: CodeHeight; flat: CodeHeight },
  codes: readonly string[],
  feetPerUnit: number | null,
): ReviewItem[] {
  if (item.level !== undefined) return [item];
  // Only a type that runs to the structure takes the roof's height; any other group is not split.
  if (levelHeightFor(item.suggested?.code ?? null, { label: "", height: heights.pitched, codes: [...codes] }) === null) return [item];
  const reads = pitchedOf(item.runs);
  const by = new Map<string, QueueRun[]>();
  item.runs.forEach((run, i) => {
    const k = reads[i] === true ? "pitched" : reads[i] === false ? "flat" : "";
    by.set(k, [...(by.get(k) ?? []), run]);
  });
  if (by.size === 1 && by.has("")) return [item];
  return [...by].map(([k, runs]) => ({
    ...item,
    key: by.size === 1 ? item.key : `${item.key}:R${k || "-"}`,
    runs,
    feet: feetOf(runs, feetPerUnit),
    ...(k === "" ? {} : { level: { label: k === "pitched" ? "under the pitched roof" : "under the flat roof", height: k === "pitched" ? heights.pitched : heights.flat, codes: [...codes] } }),
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
 * Its Set height offers the type's legend height, the set's general note and
 * the ceiling over the rooms its walls bound there, in that order
 * (`heightOptionsInOrder`), where each exists.
 */
export function heightItem(
  item: { id: string; name: string },
  sheets: readonly { sheet: QueueSheet; runs: readonly QueueRun[]; rooms: readonly CeilingRoom[] }[],
  /** The legend's height, and its options by part of the building (`legendOptions`). */
  legend: readonly HeightOption[],
  /** The set's sheet-wide rule, offered after the type's own and before the ceiling. */
  general: { feet: number; from: string } | null = null,
): ReviewItem | null {
  const on = sheets.filter((s) => s.runs.length > 0);
  if (on.length === 0) return null;
  const span = (runs: readonly QueueRun[]) => runs.reduce((n, run) => n + length(run), 0);
  const most = on.reduce((best, s) => ((feetOf(s.runs, s.sheet.feetPerUnit) ?? span(s.runs)) > (feetOf(best.runs, best.sheet.feetPerUnit) ?? span(best.runs)) ? s : best));
  const feet = on.every((s) => s.sheet.feetPerUnit === null) ? null : on.reduce((n, s) => n + (feetOf(s.runs, s.sheet.feetPerUnit) ?? 0), 0);
  const options = heightOptionsInOrder({ type: legend, general, ceiling: ceilingOption(most.runs, most.rooms) });
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
export function suggestType(
  group: WallGroup,
  sheet: string,
  legendCodes: readonly string[],
  /** The sheet's words beside its marked tags (`VARIANT_NOTES`). */
  notes: Readonly<Record<string, string>> = {},
): Guess | null {
  const tag = group.source.kind === "TAG" ? plainTag(group.source.tag) : null;
  const found = typeSource(group);
  // A marked tag ("C6*") types as its code and says what the mark means.
  const variant = tag === null || found === null ? null : variantLabel(found.type.code, tag, notes);
  if (found !== null) {
    const detail =
      found.source === "tag" || found.source === "tag-variant"
        ? `: ${tag} on ${sheet}`
        : found.source === "carried" || found.source === "sibling"
          ? `: ${tag}`
          : found.source === "thickness"
            ? `: ${inchLabel(group.inches)}`
            : "";
    const match = (found.source === "tag" || found.source === "tag-variant") && tag !== null ? `tag:${tag.toUpperCase()}` : found.source === "note" ? `note:${found.type.code.toUpperCase()}` : null;
    return { code: found.type.code, from: `${SOURCE_WORDS[found.source]}${detail}`, ...(found.source === "thickness" ? {} : { drawn: true as const }), ...(variant === null ? {} : { variant }), ...(match === null ? {} : { match }) };
  }
  if (tag !== null && group.candidates.length === 0) {
    const code = legendCodes.find((c) => c.toUpperCase() === tag.toUpperCase());
    if (code !== undefined) return { code, from: `printed tag: ${tag} on ${sheet}, in the legend but not yet your library`, drawn: true, match: `tag:${tag.toUpperCase()}` };
  }
  return null;
}

/** The height pre-filled for a type: its own (the job's item, else the legend's), else the ceiling. */
/** Where `heights` carries the set's sheet-wide rule (`generalHeightOf`): not a code any legend can print. */
export const GENERAL_HEIGHT_KEY = "*";

/**
 * A code's entry, else its family's: Joplin tags its walls A3 and B1, variants of
 * the legend's A and B (`familyOf`), and the heights and zone choices are the
 * legend's — so an A3 group is offered A's.
 */
export function forCode<T>(map: Readonly<Record<string, T>>, code: string | null): T | undefined {
  if (code === null) return undefined;
  const own = map[code.toUpperCase()];
  if (own !== undefined) return own;
  const family = familyOf(code, Object.keys(map).filter((k) => k !== GENERAL_HEIGHT_KEY));
  return family === null ? undefined : map[family];
}

/** A group's height: its type's own (or its family's), else the set's sheet-wide note ("all walls to deck U.N.O."), else the ceiling over its rooms. */
export function heightFor(code: string | null, heights: Readonly<Record<string, CodeHeight>>, ceiling: HeightOption | null): CodeHeight | null {
  const own = forCode(heights, code);
  const first = heightOptionsInOrder({ type: own === undefined ? [] : [{ kind: "legend", feet: own.feet, from: own.from }], general: heights[GENERAL_HEIGHT_KEY] ?? null, ceiling })[0];
  return first === undefined ? null : { feet: first.feet, from: first.from };
}

/**
 * "Accept all suggestions on this sheet": every group on the sheet whose type
 * the drawing gave (`Guess.drawn`), each with the height Enter would pre-fill —
 * the level's floor-to-floor for a type that runs to the structure, else the
 * type's own, else the ceiling. One function for the queue's button and Ask's
 * card, so the two accept the same groups at the same heights.
 */
export function sheetSuggestionGroups(items: readonly ReviewItem[], pageNumber: number, heights: Readonly<Record<string, CodeHeight>>, planId: string) {
  return items
    .filter((item): item is Extract<ReviewItem, { kind: "type" }> => item.kind === "type" && item.pageNumber === pageNumber && item.suggested?.drawn === true)
    .map((g) => {
      const code = g.suggested!.code;
      const byLevel = levelHeightFor(code, g.level);
      const heightFt = (byLevel ?? heightFor(code, heights, g.ceiling))?.feet ?? null;
      return { key: g.key, sheet: g.sheet, feet: g.feet, group: { planId, pageNumber: g.pageNumber, code, inches: g.inches, runs: g.runs, heightFt, level: byLevel === null ? null : g.level!.label } };
    });
}

/** Thickness within this of the confirmed group's is the same band (a sheet's buckets differ by a hair between floors). */
export const SAME_BAND_IN = 0.5;

/**
 * ── CONFIRM ONCE PER SET: THE SAME DRAWN GROUP ON THE SET'S OTHER FLOOR PLANS ──
 *
 * After a person confirms a group, every group still in the queue — on the same sheet or
 * another floor plan of the set — that the drawing names the same way (the same PRINTED
 * tag, or the same "unless noted" type: `Guess.match`), in the same thickness band, is
 * offered the type the person chose. A group tagged differently, carried, or named by
 * nothing is never among them.
 *
 * Measured 2026-11-10 against the type keys (one scorer, labels-snap-20261109T0015), the
 * estimator confirming each cluster's first group correctly: printed-tag twins end up the
 * key's type 100% on training (76 ft) and 100% held-out (900 ft, Hutto ×3). Carried tags
 * would cut that to 94.9% / 75.1%, and untagged groups matched by thickness alone are
 * 31.3% / 63.1%, so neither is offered.
 * Each keeps its own height unless it sits on the same level as the confirmed one
 * (the same item, so the same height), exactly as Enter would fill it.
 */
export function sameOnOtherFloors(
  items: readonly ReviewItem[],
  confirmed: Extract<ReviewItem, { kind: "type" }>,
  code: string,
  heightFt: number | null,
  heightOf: (item: Extract<ReviewItem, { kind: "type" }>, code: string) => number | null,
  floorPages: ReadonlySet<number>,
  planId: string,
) {
  const match = confirmed.suggested?.match;
  if (match === undefined) return [];
  const sameLevel = (g: Extract<ReviewItem, { kind: "type" }>) => (g.level?.label ?? null) === (confirmed.level?.label ?? null);
  return items
    .filter(
      (item): item is Extract<ReviewItem, { kind: "type" }> =>
        item.kind === "type" &&
        item.key !== confirmed.key &&
        (item.pageNumber === confirmed.pageNumber || floorPages.has(item.pageNumber)) &&
        item.suggested?.match === match &&
        Math.abs(item.inches - confirmed.inches) <= SAME_BAND_IN,
    )
    .map((g) => {
      const byLevel = levelHeightFor(code, g.level);
      return {
        key: g.key,
        sheet: g.sheet,
        feet: g.feet,
        group: { planId, pageNumber: g.pageNumber, code, inches: g.inches, runs: g.runs, heightFt: sameLevel(g) ? heightFt : heightOf(g, code), level: byLevel === null ? null : g.level!.label },
      };
    });
}

/**
 * ── AND WINDOWS: THE TAGS A PERSON JUST CONFIRMED, ON THE OTHER FLOORS ──
 *
 * A sheet's windows are confirmed as one count. Once one is, another floor plan of the
 * set whose counted windows ALL carry a tag the person just kept is offered as one click,
 * every window kept. A sheet with any tag not among them stays for the person, whole.
 */
export function sameWindowsOnOtherFloors(
  items: readonly ReviewItem[],
  confirmed: Extract<ReviewItem, { kind: "windows" }>,
  keptTags: ReadonlySet<string>,
  floorPages: ReadonlySet<number>,
) {
  const norm = (t: string) => t.trim().toUpperCase();
  const kept = new Set([...keptTags].map(norm));
  return items.filter(
    (item): item is Extract<ReviewItem, { kind: "windows" }> =>
      item.kind === "windows" &&
      item.key !== confirmed.key &&
      item.pageNumber !== confirmed.pageNumber &&
      floorPages.has(item.pageNumber) &&
      item.tags.length > 0 &&
      item.tags.every((t) => kept.has(norm(t))),
  );
}

// What saves the most time first (Chrome's re-test): a group is one key for
// dozens of feet, a held wall one key for one run. So groups and windows,
// then the held walls, sheet by sheet.
const KIND_ORDER: ReviewItem["kind"][] = ["type", "height", "windows", "wall", "scale", "price"];

/** What the queue counts each kind as, for "Groups 3 of 8 · Held walls 0 of 34". */
export const QUEUE_PART: Record<ReviewItem["kind"], string> = { type: "Groups", height: "Groups", windows: "Windows", wall: "Held walls", scale: "Scales", price: "Prices" };

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
