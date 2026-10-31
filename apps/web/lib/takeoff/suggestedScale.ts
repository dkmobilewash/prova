import { doorSymbols } from "./doorWindowSymbols";
import { gridBubbles } from "./gridBubbles";
import { widthAndHeight } from "./openingMarks";
import { ARCHITECTURAL_SCALES } from "./scaleFromDimensions";
import { calibrationForView } from "./sheetScale";
import { tagSymbols } from "./tagSymbols";
import type { StrokeSegment } from "./wallVectors";

const GRID_LABEL = /^(?:[A-Z]{1,2}(?:\.\d)?|\d{1,2}(?:\.\d)?)$/;

/**
 * ── A SCALE PROPOSED FROM WHAT IS DRAWN, FOR A PERSON TO CONFIRM ──
 *
 * Sheets that print no scale and no usable dimension still carry evidence. Each
 * source below votes alone, and if two disagree nothing is offered. Measured on
 * 218 training sheets with the printed scale hidden, see `zzSuggestedScale.eval`:
 *
 *   doors: at the true scale leaves land on whole inches (36, 34, 32, 30, 28).
 *   door tags: a mark beside a swing, whose schedule width equals that swing.
 *   grid: the same labelled grid lines on a sheet of known scale give the ratio.
 *   same series: A101 prints 1/8, so A102 may be, if its own doors agree.
 *
 * Same series alone is not offered: 88 right and 16 wrong, because an enlarged
 * plan sits in the series beside the overall one. Stair treads were dropped at
 * 5 right, 27 wrong, because brick and tile hatching is even parallel lines too.
 *
 * It is a proposal and nothing more. A wrong scale multiplies through every wall
 * on a sheet, so this writes nothing: `TakeoffScaleSuggestion` shows it and only
 * a press saves a calibration.
 */

/** Scales a floor plan is drawn at. 1/32" is left out: a sink's arc reads as a 3'-0" door there. */
const CANDIDATES = ARCHITECTURAL_SCALES.filter((s) => s.feetPerInch >= 2 && s.feetPerInch <= 16);
/** Sizes doors are bought in, inches. */
const DOOR_INCHES = [24, 28, 30, 32, 34, 36, 42, 48];
/** The sizes that decide it: a 24" or 48" leaf is half or double another, so it proves little. */
const CORE_INCHES = [28, 36] as const;
const TOLERANCE_INCHES = 0.75;
export const FEWEST_DOORS = 5;
/** Of the swings on the sheet, how many must land on a core size. */
const SHARE = 0.5;
/** How far the winner must beat the next scale. */
const MARGIN = 2;
const FEWEST_TAGS = 3;
const TAG_WIDTH_TOLERANCE_INCHES = 1.5;
/** How far from a swing its mark may sit, feet of building. */
const TAG_REACH_FEET = 6;
/** Sheets in the series that must print a scale, and how many of them must agree. */
const FEWEST_SERIES_SHEETS = 2;
const SERIES_SHARE = 0.75;
/** A series scale must also put this many of the sheet's own doors on door sizes. */
const SERIES_DOORS = 2;
const FEWEST_SHARED_LINES = 3;
const GRID_AGREEMENT = 0.8;
const GRID_RATIO_TOLERANCE = 0.02;
/** Grid lines closer than this on paper are too short a span to give a ratio. */
const SHORTEST_GRID_SPAN_INCHES = 0.15;
/** Labelled bubbles sharing a row sit this close across it, inches. */
const GRID_ROW_INCHES = 0.06;
/** Sheets a live viewer reads for a grid. They are read in the browser, so this is a cost cap. */
export const GRID_REFERENCE_SHEETS = 8;

export type SuggestedScale = { scaleName: string; feetPerInch: number; because: string };
export type ScaleSource = "doors" | "tags" | "grid" | "series";

type TextItem = { str: string; x: number; y: number; width: number; height: number };
export type GridAxis = { along: "row" | "column"; lines: Record<string, number> };
export type ScaleEvidence = {
  segmentsPt: readonly StrokeSegment[];
  text?: readonly TextItem[];
  doorRows?: readonly { mark: string; size?: string | null }[];
  sheetNumber?: string | null;
  /** The other sheets in the set with a known scale. */
  sameSet?: readonly { sheetNumber: string | null; feetPerInch: number }[];
  /** And their grids, for the sheets it was worth reading. */
  gridReferences?: readonly { feetPerInch: number; axes: readonly GridAxis[] }[];
};

/**
 * Only where nothing better is known. A sheet of several views has a scale per
 * view, and one figure for the whole page would be wrong on most of it.
 */
export function wantsSuggestion(sheet: { calibrated: boolean; readOnly: boolean; labelling: boolean; printedPrefill: boolean; viewScales: number }): boolean {
  return !sheet.calibrated && !sheet.readOnly && !sheet.labelling && !sheet.printedPrefill && sheet.viewScales === 0;
}

const nameOf = (feetPerInch: number) => ARCHITECTURAL_SCALES.find((s) => Math.abs(s.feetPerInch - feetPerInch) < 0.01)?.name;

/** The feet per paper inch of a printed scale, where it is a standard one. */
export function feetPerInchOf(scaleName: string | null | undefined): number | null {
  return ARCHITECTURAL_SCALES.find((s) => s.name === scaleName)?.feetPerInch ?? null;
}

type DoorsAt = { feetPerInch: number; leaves: { inches: number; widthInches: number; x: number; y: number }[]; core: number };

function doorsAtEachScale(segmentsPt: readonly StrokeSegment[]): DoorsAt[] {
  return CANDIDATES.map(({ feetPerInch }) => {
    const leaves = doorSymbols(segmentsPt, [], feetPerInch / 72).map((d) => ({
      inches: (d.widthFeet / (d.leaves === 2 ? 2 : 1)) * 12,
      widthInches: d.widthFeet * 12,
      x: (d.hinge.x + d.strike.x) / 2,
      y: (d.hinge.y + d.strike.y) / 2,
    }));
    const core = leaves.filter(
      ({ inches }) =>
        inches >= CORE_INCHES[0] - TOLERANCE_INCHES &&
        inches <= CORE_INCHES[1] + TOLERANCE_INCHES &&
        DOOR_INCHES.some((door) => Math.abs(inches - door) <= TOLERANCE_INCHES),
    ).length;
    return { feetPerInch, leaves, core };
  });
}

/** One scale's clear win, or nothing. Each source decides what a point is. */
function clearWinner<T>(scored: readonly T[], points: (one: T) => number, fewest: number): T | null {
  const sorted = [...scored].sort((a, b) => points(b) - points(a));
  const [best, next] = sorted;
  if (best === undefined || points(best) < fewest) return null;
  return next !== undefined && points(next) * MARGIN > points(best) ? null : best;
}

function fromDoors(doors: readonly DoorsAt[]) {
  const best = clearWinner(doors, (d) => d.core, FEWEST_DOORS);
  if (best === null || best.core / best.leaves.length < SHARE) return null;
  return { feetPerInch: best.feetPerInch, because: `${best.core} doors` };
}

function fromTags(doors: readonly DoorsAt[], e: ScaleEvidence) {
  const widths = new Map<string, number>();
  for (const row of e.doorRows ?? []) {
    const widthFt = widthAndHeight(row.size).widthFt;
    if (widthFt !== null) widths.set(row.mark.trim().toUpperCase(), widthFt * 12);
  }
  if (widths.size === 0) return null;
  const marks = [
    ...tagSymbols({ segments: e.segmentsPt, text: e.text ?? [], unitsPerPaperInch: 72 })
      .filter((s) => s.rejected === null || s.rejected === "sheet-reference")
      .map((s) => ({ text: s.text.trim().toUpperCase(), x: s.x, y: s.y })),
    ...(e.text ?? []).map((i) => ({ text: i.str.trim().toUpperCase(), x: i.x + i.width / 2, y: i.y - i.height / 2 })),
  ].filter((m) => widths.has(m.text));
  const scored = doors.map(({ feetPerInch, leaves }) => {
    const reach = (TAG_REACH_FEET / feetPerInch) * 72;
    const tagged = new Set<string>();
    const hit = new Set<string>();
    for (const leaf of leaves) {
      let nearest: { text: string; d: number } | null = null;
      for (const m of marks) {
        const d = Math.hypot(m.x - leaf.x, m.y - leaf.y);
        if (d <= reach && (nearest === null || d < nearest.d)) nearest = { text: m.text, d };
      }
      if (nearest === null) continue;
      tagged.add(nearest.text);
      if (Math.abs(leaf.widthInches - widths.get(nearest.text)!) <= TAG_WIDTH_TOLERANCE_INCHES) hit.add(nearest.text);
    }
    return { feetPerInch, hit: hit.size, tagged: tagged.size };
  });
  const best = clearWinner(scored, (s) => s.hit, FEWEST_TAGS);
  if (best === null || best.hit / best.tagged < SHARE) return null;
  return { feetPerInch: best.feetPerInch, because: `${best.hit} door tags on the schedule` };
}

const seriesOf = (sheetNumber: string | null | undefined) => {
  const m = /^([A-Z]+)[-.]?(\d)/.exec(sheetNumber ?? "");
  return m === null ? null : `${m[1]}${m[2]}`;
};

function fromSeries(doors: readonly DoorsAt[], e: ScaleEvidence) {
  const series = seriesOf(e.sheetNumber);
  if (series === null) return null;
  const counts = new Map<number, number>();
  for (const other of e.sameSet ?? []) {
    if (seriesOf(other.sheetNumber) === series) counts.set(other.feetPerInch, (counts.get(other.feetPerInch) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((n, c) => n + c, 0);
  if (total < FEWEST_SERIES_SHEETS) return null;
  const [feetPerInch, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  if (count / total < SERIES_SHARE) return null;
  const own = doors.find((d) => Math.abs(d.feetPerInch - feetPerInch) < 0.01)?.core ?? 0;
  return own < SERIES_DOORS ? null : { feetPerInch, because: `${count} sheets in this series and ${own} doors` };
}

/** The labelled grid lines on a sheet, by row of bubbles, in paper inches. */
export function gridAxes(segmentsPt: readonly StrokeSegment[], text: readonly TextItem[]): GridAxis[] {
  const labelled: { label: string; x: number; y: number }[] = [];
  for (const b of gridBubbles(segmentsPt, 72)) {
    const inside = text.filter(
      (i) => Math.hypot(i.x + i.width / 2 - b.x, i.y - i.height / 2 - b.y) <= b.radius && GRID_LABEL.test(i.str.trim()),
    );
    if (inside.length === 1) labelled.push({ label: inside[0]!.str.trim(), x: b.x / 72, y: b.y / 72 });
  }
  const axes: GridAxis[] = [];
  for (const [along, across, value] of [["row", "y", "x"], ["column", "x", "y"]] as const) {
    const seen = new Set<string>();
    for (const b of labelled) {
      const group = labelled.filter((o) => Math.abs(o[across] - b[across]) <= GRID_ROW_INCHES);
      const key = group.map((o) => labelled.indexOf(o)).join();
      if (group.length < FEWEST_SHARED_LINES || seen.has(key)) continue;
      seen.add(key);
      // A label twice in a row is two buildings, so it says nothing.
      const twice = new Set(group.filter((o, i) => group.findIndex((p) => p.label === o.label) !== i).map((o) => o.label));
      const lines = Object.fromEntries(group.filter((o) => !twice.has(o.label)).map((o) => [o.label, o[value]]));
      if (Object.keys(lines).length >= FEWEST_SHARED_LINES) axes.push({ along, lines });
    }
  }
  return axes;
}

/** This sheet's scale from one known sheet, if their shared grid lines keep one ratio. */
function gridRatio(mine: readonly GridAxis[], reference: { feetPerInch: number; axes: readonly GridAxis[] }): number | null {
  let best: { scale: number; spans: number } | null = null;
  for (const a of mine) {
    for (const b of reference.axes) {
      if (a.along !== b.along) continue;
      const shared = Object.keys(a.lines).filter((l) => l in b.lines).sort((p, q) => a.lines[p]! - a.lines[q]!);
      if (shared.length < FEWEST_SHARED_LINES) continue;
      const ratios: number[] = [];
      for (let i = 0; i + 1 < shared.length; i += 1) {
        const here = a.lines[shared[i + 1]!]! - a.lines[shared[i]!]!;
        const there = b.lines[shared[i + 1]!]! - b.lines[shared[i]!]!;
        if (Math.abs(here) > SHORTEST_GRID_SPAN_INCHES && Math.abs(there) > SHORTEST_GRID_SPAN_INCHES) ratios.push(there / here);
      }
      if (ratios.length < FEWEST_SHARED_LINES - 1) continue;
      const m = [...ratios].sort((x, y) => x - y)[Math.floor(ratios.length / 2)]!;
      if (!(m > 0)) continue;
      const agree = ratios.filter((r) => Math.abs(r / m - 1) <= GRID_RATIO_TOLERANCE).length;
      if (agree / ratios.length < GRID_AGREEMENT) continue;
      const scale = ARCHITECTURAL_SCALES.find((s) => Math.abs(s.feetPerInch / (reference.feetPerInch * m) - 1) <= GRID_RATIO_TOLERANCE);
      if (scale !== undefined && (best === null || ratios.length > best.spans)) best = { scale: scale.feetPerInch, spans: ratios.length };
    }
  }
  return best?.scale ?? null;
}

function fromGrid(e: ScaleEvidence) {
  const references = e.gridReferences ?? [];
  if (references.length === 0) return null;
  const mine = gridAxes(e.segmentsPt, e.text ?? []);
  if (mine.length === 0) return null;
  const votes = new Map<number, number>();
  for (const reference of references) {
    const scale = gridRatio(mine, reference);
    if (scale !== null) votes.set(scale, (votes.get(scale) ?? 0) + 1);
  }
  const best = clearWinner([...votes].map(([feetPerInch, n]) => ({ feetPerInch, n })), (v) => v.n, 1);
  return best === null ? null : { feetPerInch: best.feetPerInch, because: `the grid on ${best.n === 1 ? "another sheet" : `${best.n} other sheets`}` };
}

/** Each source's own answer, for a person reading the evidence and for the measurement. */
export function scaleVotes(e: ScaleEvidence): Partial<Record<ScaleSource, { feetPerInch: number; because: string }>> {
  const doors = doorsAtEachScale(e.segmentsPt);
  const votes = { doors: fromDoors(doors), tags: fromTags(doors, e), grid: fromGrid(e), series: fromSeries(doors, e) };
  return Object.fromEntries(Object.entries(votes).filter(([, v]) => v !== null));
}

/** One scale all the evidence agrees on, or nothing. */
export function suggestScale(e: ScaleEvidence): SuggestedScale | null {
  const votes = Object.values(scaleVotes(e));
  const first = votes[0];
  if (first === undefined || votes.some((v) => Math.abs(v.feetPerInch - first.feetPerInch) > 0.01)) return null;
  const scaleName = nameOf(first.feetPerInch);
  return scaleName === undefined ? null : { scaleName, feetPerInch: first.feetPerInch, because: votes.map((v) => v.because).join(" and ") };
}

export function suggestScaleFromDoors(segmentsPt: readonly StrokeSegment[]): SuggestedScale | null {
  return suggestScale({ segmentsPt });
}

/** The line a confirmed suggestion saves: the sheet's width, at that scale. Page-width units. */
export function suggestedCalibration(s: SuggestedScale, page: { widthPt: number; heightPt: number }) {
  return calibrationForView(
    { name: "whole sheet", scaleName: s.scaleName, feetPerInch: s.feetPerInch, from: 0, to: 1, fromY: 0, toY: page.heightPt / page.widthPt },
    page.widthPt,
  );
}

/** The form the ordinary calibration action takes, so a confirmed suggestion is an ordinary scale. */
export function suggestionForm(
  s: SuggestedScale,
  sheet: { planId: string; pageNumber: number; widthPt: number; heightPt: number },
): FormData {
  const line = suggestedCalibration(s, sheet);
  const form = new FormData();
  form.set("planId", sheet.planId);
  form.set("pageNumber", String(sheet.pageNumber));
  form.set("pageWidthPt", String(sheet.widthPt));
  form.set("points", JSON.stringify({ xs: [line.x1, line.x2], ys: [line.y1, line.y2] }));
  form.set("declaredDistanceFeet", String(line.declaredDistanceFeet));
  form.set("note", `${s.scaleName}, suggested from ${s.because} and confirmed by the estimator`);
  return form;
}
