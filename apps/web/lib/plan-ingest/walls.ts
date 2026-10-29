import { prisma } from "@prova/db";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { detectWallsForCalibration, type DetectOutcome, type DetectTarget } from "@/lib/takeoff/detectWallsForCalibration";
import { takeoffSheetVerdict } from "@/lib/takeoff/takeoffSheet";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";
import type { MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { effectiveSheetNumber, effectiveTitle, type SheetRow } from "./sheetIndex";
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

export type WallsSkip = "no scale" | "not a floor plan" | "already found";

/** Why a sheet is not a task, or null when it is one. Pure, and the whole
 *  of the planning rule, so the test can say it in four lines. */
export function wallsSkipReason(sheet: WallsSheet): WallsSkip | null {
  if (!sheet.hasScale) return "no scale";
  if (sheet.hasWalls) return "already found";
  if (takeoffSheetVerdict({ sheetNumber: sheet.sheetNumber, title: sheet.title }).skipAutomatically) {
    return "not a floor plan";
  }
  return null;
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
      const why = wallsSkipReason(sheet);
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
