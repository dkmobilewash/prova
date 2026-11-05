import { prisma } from "@prova/db";
import { pairDemoWithNewPlan, type SheetForPairing } from "./pairDemoPlans";
import type { PairChoice, Pairing } from "./priorPlan";

/**
 * Every page's demolition-plan pairing for one plan: derived from the newest
 * sheet number and title the inventory read (accepted over proposed), with a
 * person's saved change or removal on top. One read for the whole set.
 */
export type PlanPairings = {
  /** New page → its pairing; absent when it has none. */
  byPage: Map<number, Pairing>;
  /** Every page with the sheet number and title it is known by, for the picker and the sentence. */
  sheets: { pageNumber: number; sheetNumber: string | null; title: string | null }[];
};

export async function pairingsForPlan(planId: string): Promise<PlanPairings> {
  const rows = await prisma.planSheetProposal.findMany({
    where: { planId },
    orderBy: { createdAt: "desc" },
    select: { pageNumber: true, proposedSheetNumber: true, proposedTitle: true, acceptedSheetNumber: true, acceptedTitle: true },
  });
  const seen = new Set<number>();
  const sheets: PlanPairings["sheets"] = [];
  for (const r of rows) {
    if (seen.has(r.pageNumber)) continue;
    seen.add(r.pageNumber);
    sheets.push({ pageNumber: r.pageNumber, sheetNumber: r.acceptedSheetNumber ?? r.proposedSheetNumber, title: r.acceptedTitle ?? r.proposedTitle });
  }
  sheets.sort((a, b) => a.pageNumber - b.pageNumber);
  const pages = await prisma.takeoffPlanPage.findMany({
    where: { planId, priorPageChoice: { not: null } },
    select: { pageNumber: true, priorPage: true, priorPageChoice: true },
  });
  const saved = new Map<number, PairChoice>(
    pages.map((p) => [p.pageNumber, { priorPage: p.priorPage, choice: p.priorPageChoice === "user" ? "user" : p.priorPageChoice === "none" ? "none" : null }]),
  );
  const auto = autoPairs(sheets);
  const byPage = new Map<number, Pairing>();
  for (const s of sheets) {
    const pairing = pairingFor(s.pageNumber, auto, saved.get(s.pageNumber) ?? null);
    if (pairing !== null) byPage.set(s.pageNumber, pairing);
  }
  // A person may pair a page the inventory never named.
  for (const [page, choice] of saved) {
    if (!byPage.has(page) && choice.choice === "user" && choice.priorPage !== null) byPage.set(page, { demoPage: choice.priorPage, source: "user", basis: "chosen" });
  }
  return { byPage, sheets };
}

/** "AD101" or "page 7" — how the sentence names the demolition plan. */
export function sheetName(sheets: PlanPairings["sheets"], page: number): string {
  return sheets.find((s) => s.pageNumber === page)?.sheetNumber ?? `page ${page}`;
}

/** New page → its demolition plan, from sheet numbers and titles alone. Only a pair the pairer is sure of. */
export function autoPairs(sheets: readonly SheetForPairing[]): Map<number, { demoPage: number; basis: string }> {
  const out = new Map<number, { demoPage: number; basis: string }>();
  for (const pair of pairDemoWithNewPlan(sheets)) {
    if (pair.newPage === null || pair.primary === false || out.has(pair.newPage)) continue;
    out.set(pair.newPage, { demoPage: pair.demoPage, basis: pair.basis });
  }
  return out;
}

/** A person's choice wins: a page they picked, or "none" for a pair they removed. */
export function pairingFor(newPage: number, auto: ReadonlyMap<number, { demoPage: number; basis: string }>, saved: PairChoice | null): Pairing | null {
  if (saved?.choice === "none") return null;
  if (saved?.choice === "user" && saved.priorPage !== null && saved.priorPage !== newPage) return { demoPage: saved.priorPage, source: "user", basis: "chosen" };
  const a = auto.get(newPage);
  return a === undefined ? null : { demoPage: a.demoPage, source: "auto", basis: a.basis };
}

