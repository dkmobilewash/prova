import { prisma } from "@prova/db";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { detectWallsForCalibration, type DetectOutcome, type DetectTarget } from "@/lib/takeoff/detectWallsForCalibration";
import { takeoffSheetVerdict } from "@/lib/takeoff/takeoffSheet";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";
import type { MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { effectiveSheetNumber, effectiveTitle, type SheetRow } from "./sheetIndex";
import { levelFromTitle } from "./sheetLevel";
import { sheetIndexFor } from "./sheetIndexQuery";
import type { StageCtx, StageWork } from "./stages";

/**
 * ── WHOLE-SET TAKEOFF: "Find walls on every floor plan" ──
 *
 * One press, every scaled floor-plan sheet, in the background. It is a STAGE of
 * the plan-ingest runner rather than a new queue, because the runner already
 * has everything this needs: one task per sheet, an atomic claim so two tabs
 * and the cron cannot do a sheet twice, a browser-driven pump with progress,
 * and failures a person can retry. See `lib/actions/planIngest.ts` for why the
 * browser drives it (the cron runs once a day on this plan).
 *
 * The work per sheet is EXACTLY what saving a scale already triggers —
 * `detectWallsForCalibration` — so a sheet found here and a sheet found by
 * hand are the same rows, read back by the same loader, shown by the same
 * viewer. Nothing about the finder changes.
 *
 * ── WHAT IS NOT A TASK ──
 *
 * A sheet with no scale cannot be measured, a sheet whose title says it is not
 * a floor plan (a schedule, a section, the partition types) is not worth 45
 * seconds, and a sheet that already has its walls would only get them twice.
 * So those never become tasks: the run is "12 of 18 sheets" where 18 is the
 * sheets it can actually do, and the summary says what became of the rest —
 * derived from the rows, never stored (`wholeSetSummary`).
 *
 * ── COST ──
 *
 * No model is called, so nothing is spent. Time is the cost: detection reads
 * the plan file from storage and runs the finder, seconds to 45 s per sheet,
 * one sheet per advance call. On a 100-page set that is the number of floor
 * plans with a scale, not 100.
 */

export type WallsSheet = {
  pageNumber: number;
  sheetNumber: string | null;
  title: string | null;
  hasScale: boolean;
  hasWalls: boolean;
};

export type WallsSkip = "no scale" | "not a floor plan" | "already found" | `same level as ${string}`;

/** Why a sheet, on its own, is not a task — or null when it could be one.
 *  Pure. The set-level rule, one plan per floor, is `wallsPlan` below. */
export function wallsSkipReason(sheet: WallsSheet): WallsSkip | null {
  if (!sheet.hasScale) return "no scale";
  if (sheet.hasWalls) return "already found";
  if (takeoffSheetVerdict({ sheetNumber: sheet.sheetNumber, title: sheet.title }).skipAutomatically) {
    return "not a floor plan";
  }
  return null;
}

/**
 * ── ONE PLAN PER FLOOR ──
 *
 * Measured 2026-10-29 on two training sets: Baker's A100 (overall floor
 * plan) and A101 (floor plan) are the same level, and the one-press run
 * measured both and the estimate added them. A set shows a floor more than
 * once — an overall plan and a dimensioned one, a plan and its enlarged
 * areas — and the walls are the same walls.
 *
 * So the plan is made for the SET, not sheet by sheet. Sheets that could be
 * tasks (or already have walls) are grouped by the level their title names;
 * one is kept per level — the one with walls already, else the OVERALL plan,
 * else a plan that is not ENLARGED, else the lowest sheet number — and the
 * others are "same level as A100", listed as such in the summary and never
 * measured. A set whose plans name one level, or none, is one floor, and
 * its whole-floor and enlarged plans are grouped the same way; a sheet with
 * no title, or an unlevelled plan on a set that names several levels, is
 * left alone, because nothing says which floor it repeats.
 */
export function wallsPlan(sheets: readonly WallsSheet[]): Map<number, WallsSkip | null> {
  const out = new Map<number, WallsSkip | null>(sheets.map((sheet) => [sheet.pageNumber, wallsSkipReason(sheet)]));
  const candidates = sheets.filter((sheet) => {
    const reason = out.get(sheet.pageNumber);
    return reason === null || reason === "already found";
  });
  const named = new Map<WallsSheet, string>();
  for (const sheet of candidates) {
    const level = levelFromTitle(sheet.title, "PLAN");
    if (level) named.set(sheet, level.label);
  }
  // With no level named anywhere, the set is one floor: its whole-floor
  // plans and its ENLARGED plans are that floor (an enlarged toilet plan is
  // part of the floor plan beside it — Joplin A-111's 103 ft were A-101's
  // walls again), and one whole-floor plan is kept for all of them. A sheet
  // with no title at all says nothing about which floor it is, and is left
  // alone, as is a set with no whole-floor plan to keep.
  // A set whose plans name ONE level is a single storey too (Joplin says
  // "OVERALL FIRST FLOOR PLAN" once and "ENLARGED FLOOR PLANS" for its
  // toilets): an unlevelled plan there can only be that floor. With several
  // levels named, an unlevelled plan is left alone.
  const levels = new Set(named.values());
  const only = levels.size === 1 ? [...levels][0] : levels.size === 0 && candidates.some((sheet) => isWholeFloorTitle(sheet.title)) ? "" : null;
  const groups = new Map<string, WallsSheet[]>();
  for (const sheet of candidates) {
    const key = named.get(sheet) ?? (only !== null && (isWholeFloorTitle(sheet.title) || isEnlargedPlanTitle(sheet.title)) ? only : null);
    if (key === null) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(sheet);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort(preferWholeFloor)[0];
    for (const sheet of group) {
      if (sheet !== keep && out.get(sheet.pageNumber) === null) {
        out.set(sheet.pageNumber, `same level as ${keep.sheetNumber ?? `sheet ${keep.pageNumber}`}`);
      }
    }
  }
  return out;
}

/** A title that names a plan of the whole floor rather than a part of it. */
export function isWholeFloorTitle(title: string | null): boolean {
  const text = title ?? "";
  // "PLANS" too: Joplin's A-111 is titled ENLARGED FLOOR PLANS, and a
  // singular pattern let its 103 ft through on the first re-run.
  return /\bFLOOR\s+PLANS?\b|\bOVERALL\b/i.test(text) && !/\bENLARGED\b/i.test(text);
}

/** A title that names a part of a floor drawn larger — walls the floor plan already has. */
export function isEnlargedPlanTitle(title: string | null): boolean {
  return /\bENLARGED\b[^.]*\bPLANS?\b/i.test(title ?? "");
}

function preferWholeFloor(a: WallsSheet, b: WallsSheet): number {
  const score = (s: WallsSheet) =>
    (s.hasWalls ? 8 : 0) + (/\bOVERALL\b/i.test(s.title ?? "") ? 4 : 0) + (/\bENLARGED\b/i.test(s.title ?? "") ? 0 : 2);
  const byScore = score(b) - score(a);
  if (byScore !== 0) return byScore;
  return (a.sheetNumber ?? "").localeCompare(b.sheetNumber ?? "", undefined, { numeric: true }) || a.pageNumber - b.pageNumber;
}

/** Every sheet of the set as the planner sees it: the inventory's rows joined
 *  to the pages that have a scale and the walls stored against it. */
export async function wallsSheetsFor(planId: string, companyId: string): Promise<WallsSheet[]> {
  const [rows, pages] = await Promise.all([
    sheetIndexFor(planId, companyId),
    prisma.takeoffPlanPage.findMany({
      where: { planId },
      select: {
        pageNumber: true,
        calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        wallProposals: { select: { calibrationId: true } },
      },
    }),
  ]);
  const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
  const numbers = new Set<number>([...rows.map((row) => row.pageNumber), ...pages.map((page) => page.pageNumber)]);
  const rowByPage = new Map<number, SheetRow>(rows.map((row) => [row.pageNumber, row]));
  return [...numbers]
    .sort((a, b) => a - b)
    .map((pageNumber) => {
      const page = byPage.get(pageNumber);
      const row = rowByPage.get(pageNumber);
      const calibration = page?.calibrations[0] ?? null;
      return {
        pageNumber,
        sheetNumber: row ? effectiveSheetNumber(row) : null,
        title: row ? effectiveTitle(row) : null,
        hasScale: calibration !== null,
        hasWalls: calibration !== null && (page?.wallProposals ?? []).some((p) => p.calibrationId === calibration.id),
      };
    });
}

/** What the stage says about a sheet once it has looked. */
export function wallsNoteFor(outcome: DetectOutcome): { ok: true; note: string } | { ok: false; error: string } {
  switch (outcome) {
    case "written":
      return { ok: true, note: "walls found" };
    case "nothing-found":
      return { ok: true, note: "nothing found" };
    case "too-dense":
      return { ok: true, note: "too dense to read" };
    case "no-such-page":
      return { ok: true, note: "no such sheet in the file" };
    case "out-of-time":
      return { ok: false, error: "Finding the walls on this sheet took longer than the time allowed. Retry it." };
    case "unreadable":
      return { ok: false, error: "The plan file couldn't be read from storage. Retry it." };
    case "failed":
      return { ok: false, error: "Finding the walls on this sheet failed. Retry it, and tell C Stream if it keeps failing." };
  }
}

export type WallsDeps = {
  detect: (target: DetectTarget) => Promise<DetectOutcome>;
};

const realDeps: WallsDeps = {
  detect: (target) => detectWallsForCalibration(target),
};

export function wallsWork(ctx: StageCtx, deps: WallsDeps = realDeps): StageWork {
  // The company's wall types, read once per run rather than once per sheet.
  let wallTypes: Promise<MatchableWallType[]> | null = null;
  const loadWallTypes = () =>
    (wallTypes ??= prisma.wallType
      .findMany({
        where: { companyId: ctx.companyId },
        select: { id: true, code: true, name: true, thicknessIn: true, _count: { select: { components: true } } },
        orderBy: { sortOrder: "asc" },
      })
      .then((types) =>
        types.map((type) => ({
          id: type.id,
          code: type.code,
          name: type.name,
          hasParts: type._count.components > 0,
          thicknessIn: type.thicknessIn === null ? null : Number(type.thicknessIn),
        })),
      ));
  const note = (taskId: string, text: string) => prisma.planIngestTask.update({ where: { id: taskId }, data: { note: text } });

  return async (task) => {
    const page = await prisma.takeoffPlanPage.findUnique({
      where: { planId_pageNumber: { planId: ctx.planId, pageNumber: task.pageNumber } },
      select: {
        id: true,
        calibrations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true },
        },
        wallProposals: { select: { calibrationId: true } },
      },
    });
    const calibration = page?.calibrations[0] ?? null;
    const feetPerUnit =
      calibration === null
        ? null
        : feetPerPageWidth({
            x1: calibration.x1,
            y1: calibration.y1,
            x2: calibration.x2,
            y2: calibration.y2,
            declaredDistanceFeet: Number(calibration.declaredDistanceFeet),
          });
    // The planner filtered these, but a scale can be removed or walls found by
    // hand between planning and this claim — so the work checks again.
    if (page === null || calibration === null || feetPerUnit === null) {
      await note(task.id, "no scale");
      return { ok: true };
    }
    if (page.wallProposals.some((p) => p.calibrationId === calibration.id)) {
      await note(task.id, "already found");
      return { ok: true };
    }
    const outcome = await deps.detect({
      pageId: page.id,
      calibrationId: calibration.id,
      planId: ctx.planId,
      companyId: ctx.companyId,
      pageNumber: task.pageNumber,
      feetPerUnit,
      wallTypes: await loadWallTypes(),
    });
    const said = wallsNoteFor(outcome);
    if (said.ok) await note(task.id, said.note);
    return said.ok ? { ok: true } : said;
  };
}

/** One line per sheet of the set, as the panel lists them. */
export type WallsSummaryRow = {
  pageNumber: number;
  label: string;
  status:
    | { kind: "walls"; groups: number; feet: number }
    | { kind: "skipped"; why: WallsSkip }
    | { kind: "looked"; note: string }
    | { kind: "failed"; error: string }
    | { kind: "pending" };
};

export function wallsSummaryRows(input: {
  sheets: WallsSheet[];
  /** Found walls per page, for its current scale: group count and feet. */
  walls: Map<number, { groups: number; feet: number }>;
  /** The newest WALLS run's tasks, by page. */
  tasks: Map<number, { finishedAt: Date | null; note: string | null; error: string | null; attempts: number }>;
  maxAttempts: number;
}): WallsSummaryRow[] {
  const plan = wallsPlan(input.sheets);
  return input.sheets.map((sheet) => {
    const label = [sheet.sheetNumber, sheet.title].filter(Boolean).join(" — ") || `Sheet ${sheet.pageNumber}`;
    const found = input.walls.get(sheet.pageNumber);
    const task = input.tasks.get(sheet.pageNumber);
    let status: WallsSummaryRow["status"];
    if (found) status = { kind: "walls", ...found };
    else if (task?.finishedAt && task.note) status = { kind: "looked", note: task.note };
    else if (task && !task.finishedAt && task.error && task.attempts >= input.maxAttempts) status = { kind: "failed", error: task.error };
    else if (task && !task.finishedAt) status = { kind: "pending" };
    else {
      const why = plan.get(sheet.pageNumber) ?? null;
      status = why === null ? { kind: "pending" } : { kind: "skipped", why };
    }
    return { pageNumber: sheet.pageNumber, label, status };
  });
}

export async function wholeSetSummary(planId: string, companyId: string, maxAttempts: number): Promise<WallsSummaryRow[]> {
  const [sheets, pages, types, run] = await Promise.all([
    wallsSheetsFor(planId, companyId),
    prisma.takeoffPlanPage.findMany({
      where: { planId },
      select: {
        pageNumber: true,
        calibrations: { orderBy: { createdAt: "desc" }, take: 1 },
        wallProposals: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.wallType.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true, thicknessIn: true, _count: { select: { components: true } } },
    }),
    prisma.planIngestJob.findFirst({
      where: { planId, stage: "WALLS" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { tasks: { select: { pageNumber: true, finishedAt: true, note: true, error: true, attempts: true } } },
    }),
  ]);
  const wallTypes: MatchableWallType[] = types.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    hasParts: type._count.components > 0,
    thicknessIn: type.thicknessIn === null ? null : Number(type.thicknessIn),
  }));
  const walls = new Map<number, { groups: number; feet: number }>();
  for (const page of pages) {
    const current = page.calibrations[0];
    if (!current) continue;
    const feetPerUnit = feetPerPageWidth({
      x1: current.x1,
      y1: current.y1,
      x2: current.x2,
      y2: current.y2,
      declaredDistanceFeet: current.declaredDistanceFeet.toNumber(),
    });
    const mine = page.wallProposals.filter((row) => row.calibrationId === current.id);
    if (feetPerUnit === null || mine.length === 0) continue;
    const newest = mine[0].createdAt.getTime();
    const groups = groupsFromProposals(
      mine.filter((row) => row.createdAt.getTime() === newest),
      wallTypes,
      feetPerUnit,
    );
    if (groups !== null && groups.length > 0) {
      walls.set(page.pageNumber, { groups: groups.length, feet: groups.reduce((sum, group) => sum + group.feet, 0) });
    }
  }
  return wallsSummaryRows({
    sheets,
    walls,
    tasks: new Map((run?.tasks ?? []).map((task) => [task.pageNumber, task])),
    maxAttempts,
  });
}
