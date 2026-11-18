import { prisma } from "@prova/db";
import { deckPrefill, wallHeightConventionFrom, wallsGoToDeck, type DeckPrefill } from "./heightsByCode";
import { deckAnswerFt, FLOOR_TO_FLOOR, planHeights } from "./wallHeightsAssign";

/**
 * ── ONE PRESS FOR THE DECK (Diego, 2026-11-18) ──
 *
 * Drawings rarely print a deck elevation (Round 28: two stated values in four sets that were picked
 * for printing them). So when a job's walls go to deck or structure and the set prints no deck
 * elevation, the review queue asks ONCE: "Walls go to deck: deck height?", pre-filled with what
 * C-Stream read — the floor-to-floor through the sections' level marks, else the set's one bearing
 * line — else the company's usual height, its source shown. The answer goes on every to-deck wall of
 * the job (`wallHeightChain`), with Undo. Behind TAKEOFF_DECK_QUESTION=1, off by default.
 */
export const deckQuestionOn = (env: Record<string, string | undefined> = process.env) => env.TAKEOFF_DECK_QUESTION === "1";

export type DeckItem = { kind: "deck"; key: string; walls: number; prefill: DeckPrefill };

/** The job's deck question, or null: gate off, already answered, walls not to deck, a deck printed, or no to-deck wall yet. */
export async function deckQuestionFor(companyId: string, jobId: string, env: Record<string, string | undefined> = process.env): Promise<DeckItem | null> {
  if (!deckQuestionOn(env)) return null;
  const plan = await prisma.takeoffPlan.findFirst({ where: { jobId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (plan === null || (await deckAnswerFt(plan.id)) !== null) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { defaultWallHeightFt: true, wallHeightConvention: true } });
  const answer = { convention: wallHeightConventionFrom(company?.wallHeightConvention), fixedFt: company?.defaultWallHeightFt == null ? null : Number(company.defaultWallHeightFt) };
  const heights = await planHeights(plan.id, null);
  // A deck the set prints (one structure elevation, or the rule drawn from it) is never asked.
  if (!wallsGoToDeck(heights.rule, answer) || heights.structureFt !== null || heights.rule?.kind === "to-structure") return null;
  // The walls it would move: those whose height is still the assumed one.
  const walls = await prisma.takeoffMeasurement.findMany({
    where: { kind: "LINEAR", page: { planId: plan.id }, item: { companyId }, heightAssumed: true },
    select: { page: { select: { pageNumber: true } } },
  });
  if (walls.length === 0) return null;
  const perPage = new Map<number, number>();
  for (const w of walls) perPage.set(w.page.pageNumber, (perPage.get(w.page.pageNumber) ?? 0) + 1);
  const reads = await prisma.takeoffPlanTextRead.findMany({ where: { planId: plan.id, kind: FLOOR_TO_FLOOR, pageNumber: { in: [...perPage.keys()] } }, select: { pageNumber: true, value: true } });
  const prefill = deckPrefill({
    floorToFloor: reads.map((r) => ({ feet: ((r.value as { feet?: number | null } | null)?.feet ?? null) as number | null, walls: perPage.get(r.pageNumber) ?? 0 })),
    bearingFt: heights.bearingFt ?? null,
    fixedFt: answer.fixedFt,
  });
  return { kind: "deck", key: `deck:${jobId}`, walls: walls.length, prefill };
}
