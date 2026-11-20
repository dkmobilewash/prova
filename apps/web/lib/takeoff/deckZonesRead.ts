import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import { printedScalesAt } from "./printedScales";
import { sheetViews } from "./sheetViews";
import { alignViews, longFaces } from "./viewAlign";
import { deckValues, deckZones, floorStatement, framingLevel, slopeFromRoofPlan, type DeckValue, type DeckZones } from "./deckHeights";
import { planLevels } from "./levelHeights";
import { ABSOLUTE_FEET, heightFactsFromText } from "./wallHeights";

/**
 * ── THE STRUCTURAL ELEVATIONS LAID OVER EACH FLOOR PLAN (H4', prereg-type-heights.md) ──
 *
 * Deck, bearing and steel elevations printed on a framing or roof plan rule where they are printed,
 * so the framing plan is laid over the floor plan the way the roof plan already is
 * (`roofPartsRead.ts`: the long wall faces that agree, at least `DECK_ALIGN_VOTES`). Elevations on
 * sections and wall sections carry no plan position: one value they all agree on is the plan's
 * default, and anything else from them is left out rather than guessed into place.
 */
export const DECK_ZONES = "DECK_ZONES";
export const DECK_ALIGN_VOTES = 20;
export type StoredDeckZones = { zones: DeckZones };

const FRAMING_VIEW = /\bFRAMING\s+PLAN\b|\bROOF\s+PLAN\b|\bSTRUCTURAL\s+PLAN\b/i;
const SECTION_VIEW = /\bSECTION\b|\bELEVATION\b/i;
const FLOOR_VIEW = /\bFLOOR\s+PLAN\b/i;

function feetPerUnitOf(items: readonly { str: string; x: number; y: number }[], widthPt: number): number | null {
  const count = new Map<string, { n: number; feetPerInch: number }>();
  for (const s of printedScalesAt(items)) count.set(s.name, { n: (count.get(s.name)?.n ?? 0) + 1, feetPerInch: s.feetPerInch });
  const top = [...count].sort((a, b) => b[1].n - a[1].n)[0];
  return top === undefined ? null : (widthPt / 72) * top[1].feetPerInch;
}

/** Each floor plan page's deck zones, in that page's own page-width units. */
export async function deckZonesFor(
  doc: PlanPdf,
  floorElevation: number | null,
  /** The pages whose walls need heights, with their scale: the sheet being priced, whatever its caption ("AREA A ENLARGED PLAN"). Absent: every floor plan the set captions as one. */
  forPages?: readonly { page: number; feetPerUnit: number }[],
  maxPages = 160,
): Promise<Map<number, StoredDeckZones>> {
  const framing: { page: number; values: DeckValue[]; level: number | "roof" | null }[] = [];
  const sectionValues: DeckValue[] = [];
  const sectionSlope: DeckValue[] = [];
  const roofPlans: { page: number; items: { str: string; x: number; y: number }[] }[] = [];
  // The floor's printed elevation ("FIRST FLOOR 100'-0""), commonest on the sections, when none is given.
  const datums: number[] = [];
  // A floor a sentence STATES ("FINISH FLOOR ELEVATION OF 100'-0"", "T O SLAB EL=100'-0"") outranks
  // one read off a section's level label: K-4's section labels gave 99'-9 1/2" beside its stated 100'-0".
  const stated: number[] = [];
  const slabs: number[] = [];
  const floors: { page: number; feetPerUnit: number; level: number | null }[] = [];
  for (let page = 1; page <= Math.min(doc.pageCount, maxPages); page += 1) {
    let t: Awaited<ReturnType<PlanPdf["pageText"]>>;
    try { t = await doc.pageText(page); } catch { continue; }
    const views = sheetViews(t.items, t.widthPt).map((v) => v.name).join(" | ");
    for (const i of t.items) {
      const f = floorStatement(i.str);
      if (f !== null) (f.slab ? slabs : stated).push(f.feet);
    }
    const W = t.widthPt;
    const values = () => deckValues(t.items.map((i) => ({ str: i.str, x: i.x / W, y: i.y / W, height: i.height / W })));
    if (FRAMING_VIEW.test(views)) {
      const v = values();
      if (v.length > 0) framing.push({ page, values: v, level: sheetViews(t.items, t.widthPt).map((x) => framingLevel(x.name)).find((l) => l !== null) ?? null });
      if (/\bROOF\s+PLAN\b/i.test(views)) roofPlans.push({ page, items: t.items.map((i) => ({ str: i.str, x: i.x / W, y: i.y / W })) });
    } else if (SECTION_VIEW.test(views)) {
      const v = values();
      sectionValues.push(...v.filter((x) => x.kind !== "eave" && x.kind !== "ridge"));
      sectionSlope.push(...v.filter((x) => x.kind === "eave" || x.kind === "ridge"));
      for (const f of heightFactsFromText({ sheet: `p${page}`, items: t.items })) if (f.kind === "floor-datum" && f.feet !== null && f.feet > ABSOLUTE_FEET) datums.push(f.feet);
    }
    const wanted = forPages?.find((f) => f.page === page);
    if (wanted !== undefined) floors.push({ page, feetPerUnit: wanted.feetPerUnit, level: sheetViews(t.items, t.widthPt).map((x) => planLevels(x.name)[0]).find((l) => l !== undefined) ?? null });
    else if (forPages === undefined && FLOOR_VIEW.test(views) && !/CEILING|ROOF|FRAMING|DEMO/i.test(views)) {
      const fpu = feetPerUnitOf(t.items, W);
      if (fpu !== null) floors.push({ page, feetPerUnit: fpu, level: sheetViews(t.items, t.widthPt).map((x) => planLevels(x.name)[0]).find((l) => l !== undefined) ?? null });
    }
  }
  floorElevation = commonest(stated) ?? commonest(slabs) ?? floorElevation ?? commonest(datums);
  // A sloped roof: the roof plan's EAVE/RIDGE labels, at the sections' one eave and one ridge elevation.
  for (const r of roofPlans) {
    const placed = slopeFromRoofPlan(r.items, sectionSlope);
    if (placed.length === 0) continue;
    const had = framing.find((f) => f.page === r.page);
    if (had !== undefined) had.values.push(...placed);
    else framing.push({ page: r.page, values: placed, level: "roof" });
  }
  // One value every section agrees on is the plan's default; several disagreeing ones say nothing alone.
  const sectionDefault = (() => {
    const distinct = [...new Set(sectionValues.map((v) => Math.round(v.elevation * 96) / 96))];
    return distinct.length === 1 ? [{ ...sectionValues[0]!, uno: true }] : [];
  })();
  const out = new Map<number, StoredDeckZones>();
  const strokes = new Map<number, Awaited<ReturnType<PlanPdf["pageStrokes"]>>>();
  const strokesOf = async (p: number) => strokes.get(p) ?? strokes.set(p, await doc.pageStrokes(p)).get(p)!;
  // ── EACH FLOOR'S WALLS RUN TO THE FRAMING OF THE LEVEL ABOVE IT ──
  // 114026: the second floor's framing (T.O.S. 114'-2 1/2") carries the first floor's walls, the roof's
  // (T.O.S. 129') the second floor's. A floor plan whose level is not printed pairs only on a one-storey set.
  const multi = framing.some((f) => typeof f.level === "number" && f.level >= 2);
  const levelElevation = (level: number): number | null => {
    const v = framing.filter((f) => f.level === level).flatMap((f) => f.values.map((x) => Math.round(x.elevation * 96) / 96));
    if (v.length === 0) return null;
    const count = new Map<number, number>();
    for (const e of v) count.set(e, (count.get(e) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1])[0]![0];
  };
  for (const floor of floors) {
    const plan = await strokesOf(floor.page);
    const L = floor.level;
    if (multi && L === null) continue;
    const carries = (f: (typeof framing)[number]) => L === null ? true : f.level === L + 1 || (f.level === "roof" && !framing.some((g) => g.level === L + 1)) || f.level === null;
    const floorAt = L === null || L <= 1 ? floorElevation : levelElevation(L);
    let best: { values: DeckValue[]; dx: number; dy: number; votes: number } | null = null;
    for (const f of framing.filter(carries)) {
      const s = await strokesOf(f.page);
      const shift = alignViews(longFaces(plan.segments, plan.widthPt, floor.feetPerUnit), longFaces(s.segments, s.widthPt, floor.feetPerUnit), floor.feetPerUnit);
      if (shift !== null && shift.votes >= DECK_ALIGN_VOTES && (best === null || shift.votes > best.votes)) best = { values: f.values, ...shift };
    }
    if (process.env.DECK_DEBUG) console.log(`DECKDBG floor p${floor.page} L=${L} fpu=${floor.feetPerUnit.toFixed(1)} floorAt=${floorAt} candidates=${framing.filter(carries).map((f) => `p${f.page}:${f.level}`).join(",")} best=${best === null ? "none" : best.votes}`);
    // Unaligned framing plans still state their UNO default for the whole plan.
    const planWide = framing.flatMap((f) => f.values.filter((v) => v.uno));
    const placed = best === null ? [] : best.values.map((v) => ({ ...v, x: v.x + best!.dx, y: v.y + best!.dy }));
    const zones = deckZones([...placed, ...(placed.some((v) => v.uno) ? [] : planWide), ...(placed.length === 0 && planWide.length === 0 ? sectionDefault : [])], { floorElevation: floorAt });
    if (zones.defaultFeet !== null || zones.points.length > 0 || zones.eaves.length > 0) out.set(floor.page, { zones });
  }
  return out;
}

function commonest(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]![0];
}
