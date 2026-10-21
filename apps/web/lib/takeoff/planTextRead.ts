import { prisma } from "@prova/db";
import { extractScheduleRows } from "@prova/integrations";
import { aiGate } from "@/lib/ai/settings";
import type { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { scheduleRowsFromJson } from "@/lib/plan-ingest/scheduleRowsJson";
import { gridText, tableRowsFromPage } from "@/lib/plan-ingest/scheduleTable";
import { bareTextTags } from "./bareTextTags";
import { inPageWidthUnits } from "./findWallsOnSheet";
import { legendPages, type PageForLegend } from "./legendPages";
import { openingsInWalls } from "./openings";
import { joinOpeningsToSchedule, widthAndHeight, type PlacedMark } from "./openingMarks";
import { planTextKeys, readPlanTextCache, writePlanTextCache } from "./planTextCache";
import { isPropagatedTag } from "./planTextTags";
import { readWallLegend, type WallLegendProposal } from "./readWallLegend";
import { tagSymbols, type TextForSymbol } from "./tagSymbols";
import type { WallGroup } from "./wallGroups";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── WHAT `detectWallsForCalibration` DOES WHEN THE SWITCH IS ON ──
 *
 * Three reads, each once per plan set and cached, and one join per sheet:
 *
 *   - the partition LEGEND: `legendPages` picks the page, `readWallLegend`
 *     reads it (one model call, behind `SCHEDULE_READ`), and its codes are the
 *     vocabulary the finder's symbol tags are filtered by;
 *   - the DOOR SCHEDULE: taken from `PlanScheduleProposal` where the ingest
 *     already read one (a database READ), else read here the same way;
 *   - the join of that schedule to the sheet's openings and marks, which is
 *     the per-sheet result the screen shows.
 *
 * None of it writes to the database. The results go to `planTextCache`; the
 * tables they want are named there.
 */

type PlanDoc = Awaited<ReturnType<typeof openPlanPdf>>;

export type PlanTextLegend = {
  page: number;
  title: string | null;
  codes: string[];
  proposals: WallLegendProposal[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type PlanTextDoorRow = { mark: string; size: string | null; description: string | null };

export type PlanTextDoors = {
  page: number;
  rows: PlanTextDoorRow[];
  from: "ingest" | "model";
};

export type PlacedDoor = {
  mark: string;
  widthFt: number;
  widthFrom: "schedule" | "drawn";
  placedBy: "opening" | "mark";
  /** Midpoint, in page-width units, so the screen can put it on a run. */
  x: number;
  y: number;
  description: string | null;
};

export type PlanTextSheetResult = {
  planId: string;
  pageNumber: number;
  calibrationId: string;
  legend: { page: number; codes: string[] } | null;
  doors: { schedulePage: number; placed: PlacedDoor[]; unplaced: string[]; rowsTotal: number } | null;
  typed: { taggedFeet: number; propagatedFeet: number; noteFeet: number; untypedFeet: number };
};

/** The page's text as lines, cells on one line joined by " | ". */
export async function pageLines(doc: PlanDoc, page: number): Promise<string[]> {
  const text = await doc.pageText(page);
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const item of text.items) {
    if (item.str.trim() === "") continue;
    const key = Math.round(item.y / 6);
    rows.set(key, [...(rows.get(key) ?? []), { x: item.x, str: item.str }]);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) =>
      cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str.trim())
        .join(" | "),
    );
}

async function titlesFor(planId: string): Promise<Map<number, string | null>> {
  const rows = await prisma.planSheetText.findMany({
    where: { planId },
    select: { pageNumber: true, titleBlockText: true },
  });
  return new Map(rows.map((r) => [r.pageNumber, r.titleBlockText]));
}

/**
 * The set's legend, read once. Null when none was found, the model refused,
 * or the deadline passed before every page was scanned — in which case the
 * next calibration tries again rather than caching a miss.
 */
export async function legendForPlan(input: {
  companyId: string;
  planId: string;
  doc: PlanDoc;
  outOfTime: () => boolean;
}): Promise<PlanTextLegend | null> {
  const key = planTextKeys.legend(input.planId);
  const cached = readPlanTextCache<PlanTextLegend>(key);
  if (cached !== null) return cached;

  const titles = await titlesFor(input.planId);
  const pages: PageForLegend[] = [];
  for (let page = 1; page <= input.doc.pageCount; page++) {
    if (input.outOfTime()) return null;
    pages.push({ page, title: titles.get(page) ?? null, lines: await pageLines(input.doc, page) });
  }
  const candidates = legendPages(pages);
  // The best page, then the next, so a legend whose first candidate is an
  // index entry still gets read; never more, because each is a model call.
  for (const candidate of candidates.slice(0, 2)) {
    if (input.outOfTime()) return null;
    const page = pages.find((p) => p.page === candidate.page);
    if (page === undefined) continue;
    const read = await readWallLegend({
      companyId: input.companyId,
      lines: page.lines,
      pageNumber: candidate.page,
      sheetTitle: page.title,
      where: `page ${candidate.page}`,
    });
    if (!read.ok || read.proposals.length === 0) continue;
    const legend: PlanTextLegend = {
      page: candidate.page,
      title: page.title,
      codes: read.proposals.map((p) => p.code.toUpperCase()),
      proposals: read.proposals,
      reason: read.reason,
      confidence: read.confidence,
    };
    writePlanTextCache(key, legend);
    return legend;
  }
  return null;
}

const DOOR_SCHEDULE_TITLE = /\bDOOR\b.*\bSCHEDULE\b|\bSCHEDULE\b.*\bDOOR\b/i;

/** The set's door schedule: the ingest's read where there is one, else one call, cached. */
export async function doorScheduleForPlan(input: {
  companyId: string;
  planId: string;
  doc: PlanDoc;
  outOfTime: () => boolean;
}): Promise<PlanTextDoors | null> {
  const fromIngest = await prisma.planScheduleProposal.findFirst({
    where: { planId: input.planId, kind: "DOOR" },
    orderBy: { createdAt: "desc" },
    select: { pageNumber: true, rows: true },
  });
  if (fromIngest !== null) {
    const rows = scheduleRowsFromJson(fromIngest.rows).map((r) => ({ mark: r.mark, size: r.size, description: r.description }));
    if (rows.length > 0) return { page: fromIngest.pageNumber, rows, from: "ingest" };
  }

  const key = planTextKeys.doors(input.planId);
  const cached = readPlanTextCache<PlanTextDoors>(key);
  if (cached !== null) return cached;

  const titles = await titlesFor(input.planId);
  const byTitle = [...titles].filter(([, t]) => t !== null && DOOR_SCHEDULE_TITLE.test(t)).map(([p]) => p);
  const candidates: number[] = [...byTitle];
  if (candidates.length === 0) {
    for (let page = 1; page <= input.doc.pageCount; page++) {
      if (input.outOfTime()) return null;
      const lines = await pageLines(input.doc, page);
      if (lines.some((l) => /^DOOR(?: AND FRAME)? SCHEDULE$/i.test(l.split(" | ")[0].trim()))) candidates.push(page);
    }
  }
  if (candidates.length === 0) return null;
  if (input.outOfTime()) return null;
  const gate = await aiGate(input.companyId, "SCHEDULE_READ");
  if (!gate.ok) return null;
  const page = candidates[0];
  const table = tableRowsFromPage(await input.doc.pageText(page));
  let read: Awaited<ReturnType<typeof extractScheduleRows>>;
  try {
    read = await extractScheduleRows({
      grid: gridText(table),
      pageNumber: page,
      sheetTitle: titles.get(page) ?? "DOOR SCHEDULE",
      model: gate.model,
    });
  } catch {
    return null;
  }
  if (read.kind !== "DOOR" || read.rows.length === 0) return null;
  const doors: PlanTextDoors = {
    page,
    rows: read.rows.map((r) => ({ mark: r.mark, size: r.size ?? null, description: r.description ?? null })),
    from: "model",
  };
  writePlanTextCache(key, doors);
  return doors;
}

/**
 * Join a read schedule to one sheet: openings from the line work, marks from
 * symbols and bare text (the schedule is the vocabulary), placed on the
 * nearest run where no gap was detected.
 */
export function doorsOnSheet(input: {
  /** Strokes in points. */
  segments: readonly StrokeSegment[];
  widthPt: number;
  /** Text as the PDF gives it, `y` the baseline. */
  text: readonly TextForSymbol[];
  /** Runs in page-width units. */
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  rows: readonly PlanTextDoorRow[];
}): { placed: PlacedDoor[]; unplaced: string[]; rowsTotal: number } {
  const { segments, widthPt, text, walls, feetPerUnit, rows } = input;
  const openings = openingsInWalls(segments.map(inPageWidthUnits(widthPt)), feetPerUnit);
  const symbols = tagSymbols({ segments, text, unitsPerPaperInch: 72 });
  const markSet = new Set(rows.map((r) => r.mark.trim().toUpperCase()));
  const symbolMarks: PlacedMark[] = symbols
    // A scheduled mark overrides the sheet-reference rejection, as a legend
    // code does for walls: Bunkie's `E105A` reads as a callout and is a door.
    .filter((s) => s.rejected === null || (s.rejected === "sheet-reference" && markSet.has(s.text.trim().toUpperCase())))
    .map((s) => ({ text: s.text, x: s.x / widthPt, y: s.y / widthPt, inSymbol: true }));
  const bare = bareTextTags({ text, vocabulary: markSet, symbols, walls, feetPerUnit, widthPt }).map((b) => ({
    text: b.text,
    x: b.x,
    y: b.y,
  }));
  const scheduled = rows.map((r) => {
    const { widthFt, heightFt } = widthAndHeight(r.size);
    return { mark: r.mark, widthFt, heightFt, description: r.description };
  });
  const join = joinOpeningsToSchedule({ openings, marks: [...symbolMarks, ...bare], rows: scheduled, feetPerUnit, walls });
  const placed: PlacedDoor[] = join.openings
    .filter((o) => o.matched !== null && o.mark !== null)
    .map((o) => ({
      mark: o.mark as string,
      widthFt: o.widthFt,
      widthFrom: o.widthFrom,
      placedBy: o.placedBy,
      x: (o.opening.x1 + o.opening.x2) / 2,
      y: (o.opening.y1 + o.opening.y2) / 2,
      description: o.matched?.description ?? null,
    }));
  const placedMarks = new Set(placed.map((p) => p.mark.trim().toUpperCase()));
  const unplaced = rows.map((r) => r.mark).filter((m) => !placedMarks.has(m.trim().toUpperCase()));
  return { placed, unplaced, rowsTotal: rows.length };
}

/** Feet by where the type came from, over the groups the finder returned. */
export function typedFeetOf(groups: readonly WallGroup[]): PlanTextSheetResult["typed"] {
  const typed = { taggedFeet: 0, propagatedFeet: 0, noteFeet: 0, untypedFeet: 0 };
  for (const group of groups) {
    if (group.source.kind === "TAG") {
      if (isPropagatedTag(group.source.tag)) typed.propagatedFeet += group.feet;
      else typed.taggedFeet += group.feet;
    } else if (group.source.kind === "GENERAL_NOTE") typed.noteFeet += group.feet;
    else typed.untypedFeet += group.feet;
  }
  return typed;
}

export function writeSheetResult(result: PlanTextSheetResult): void {
  writePlanTextCache(planTextKeys.result(result.planId, result.pageNumber), result);
}

export function readSheetResult(planId: string, pageNumber: number): PlanTextSheetResult | null {
  return readPlanTextCache<PlanTextSheetResult>(planTextKeys.result(planId, pageNumber));
}

export function readLegend(planId: string): PlanTextLegend | null {
  return readPlanTextCache<PlanTextLegend>(planTextKeys.legend(planId));
}
