import { after } from "next/server";
import { prisma } from "@prova/db";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { windowsForSheet } from "@/lib/plan-ingest/rooms";
import { detectWallsForCalibration } from "./detectWallsForCalibration";
import { legendHeightsFor } from "./legendHeights";
import { stampOf, stampSuggestions, suggestionsStale, SUGGESTIONS_READ } from "./suggestionStamp";

/**
 * ── A LEGEND THAT LANDS AFTER THE TAKEOFF STILL REACHES THE QUEUE ──
 *
 * The job's counted sheets (walls on the job from a run) whose stamp is older
 * than the newest legend save or the current rules (`suggestionStamp.ts`) are
 * worked out again: the walls detected afresh with the stored legend, the
 * windows counted again, and the set's sheet-wide height stored from the legend.
 *
 * NOTHING A PERSON DECIDED MOVES. Detection only appends a newer proposal run,
 * which the queue reads for the groups still untyped; the measurements on the
 * job, typed or kept or dropped, are not touched (unlike Run takeoff again,
 * `refreshSheetWalls`), and a window count already decided is left alone
 * (`writeSuggestedWindows`). And NO MODEL IS CALLED: detection is told to use
 * stored reads only.
 */
export async function staleSuggestionSheets(planId: string): Promise<number[]> {
  const [pages, stamps, legend] = await Promise.all([
    prisma.takeoffPlanPage.findMany({ where: { planId, measurements: { some: { source: "DETECTED", kind: "LINEAR" } } }, select: { pageNumber: true }, orderBy: { pageNumber: "asc" } }),
    prisma.takeoffPlanTextRead.findMany({ where: { planId, kind: SUGGESTIONS_READ }, select: { pageNumber: true, value: true, computedAt: true } }),
    prisma.planLegendProposal.aggregate({ where: { planId }, _max: { updatedAt: true } }),
  ]);
  const legendSavedAt = legend._max.updatedAt;
  return pages
    .map((p) => p.pageNumber)
    .filter((n) => {
      const row = stamps.find((s) => s.pageNumber === n);
      return suggestionsStale(row === undefined ? null : stampOf(row.value, row.computedAt), legendSavedAt);
    });
}

// ponytail: per-instance guard; a second instance repeats the work harmlessly (proposals append, the queue reads the newest).
const running = new Set<string>();

export async function refreshSuggestions(input: { planId: string; companyId: string }): Promise<number[]> {
  if (running.has(input.planId)) return [];
  running.add(input.planId);
  try {
    const stale = await staleSuggestionSheets(input.planId);
    if (stale.length === 0) return [];
    const legend = await prisma.planLegendProposal.findFirst({ where: { planId: input.planId }, orderBy: { updatedAt: "desc" }, select: { pageNumber: true } });
    if (legend !== null) await legendHeightsFor({ planId: input.planId, companyId: input.companyId, legendPage: legend.pageNumber, types: [] });
    const wallTypes = (
      await prisma.wallType.findMany({ where: { companyId: input.companyId }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, thicknessIn: true, _count: { select: { components: true } } } })
    ).map((t) => ({ id: t.id, code: t.code, name: t.name, hasParts: t._count.components > 0, thicknessIn: t.thicknessIn === null ? null : Number(t.thicknessIn) }));
    for (const pageNumber of stale) {
      const readAt = new Date();
      const page = await prisma.takeoffPlanPage.findUnique({
        where: { planId_pageNumber: { planId: input.planId, pageNumber } },
        select: { id: true, calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } } },
      });
      const calibration = page?.calibrations[0];
      const feetPerUnit = calibration === undefined ? null : feetPerPageWidth({ ...calibration, declaredDistanceFeet: Number(calibration.declaredDistanceFeet) });
      const outcome =
        page === null || calibration === undefined || feetPerUnit === null
          ? "no scale"
          : await detectWallsForCalibration({
              // Handed so each run keeps its model score, as the whole-set run's proposals do.
              onBoundary: () => {},
              pageId: page.id,
              calibrationId: calibration.id,
              planId: input.planId,
              companyId: input.companyId,
              pageNumber,
              feetPerUnit,
              wallTypes,
              pairWithThicknesses: false,
              noModel: true,
            });
      // A sheet detection did not write is stamped anyway, so it is not tried on every load.
      if (outcome !== "written") await stampSuggestions(input.planId, pageNumber, readAt);
      await windowsForSheet({ planId: input.planId, companyId: input.companyId, pageNumber }).catch((error) =>
        console.error("[takeoff] windows on a refreshed sheet failed", { planId: input.planId, pageNumber }, error),
      );
    }
    return stale;
  } finally {
    running.delete(input.planId);
  }
}

/** The same, once the response has gone out — `detectWallsAfterResponse`'s reasoning. Outside a request it does nothing. */
export function refreshSuggestionsAfterResponse(input: { planId: string; companyId: string }): void {
  try {
    after(() =>
      refreshSuggestions(input).catch((error) => {
        console.error("[takeoff] suggestion refresh failed", { planId: input.planId }, error);
      }),
    );
  } catch {
    // Not in a request scope.
  }
}
