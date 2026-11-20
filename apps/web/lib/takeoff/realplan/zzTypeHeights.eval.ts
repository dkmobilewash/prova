import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { runsHeldOffEstimate } from "../estimateHold";
import { enlargedPlanReason, excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, wallTestFromLabels, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { priorPlanFor } from "../priorPlan";
import { autoPairs } from "../priorPlanLoad";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import { loadRunModel, priorForRuns, runModelVerdicts } from "../wallRunModel";
import { reviewOrder, runScores } from "../wallReview";
import type { WallCandidate } from "../wallVectors";
import { setFigures, setHeightRule, wallHeightChain, type SetFigures, type SetHeightRule, type WallHeightConvention } from "../heightsByCode";
import { levelHeight, planLevels, type LevelMark } from "../levelHeights";
import { setHeightFacts } from "../setHeightFacts";
import { CEILING_PAGE_TITLE } from "../../plan-ingest/rooms";
import { tableRowsFromPage } from "../../plan-ingest/scheduleTable";
import { ceilingsForRooms, type CeilingPageText } from "../roomCeilings";
import { roofPartsFor, type StoredRoofParts } from "../roofPartsRead";
import { sheetRooms } from "../sheetRooms";
import { wallChainWithRooms } from "../wallSides";
import { keyWallFeet, loadKeyTypes, parseRoomZoneKey, type HeightsKeyType, type RoomZone } from "../roomZoneKey";
import { wallSideCeilings, wallSideRooms } from "../wallSides";
import { sheetViews } from "../sheetViews";
import { generalTypeRule, typeHeightRule, wallHeightByType, type TypeHeightRule } from "../typeHeights";
import { deckZonesFor, type StoredDeckZones } from "../deckZonesRead";
import { wallOverlapFeet } from "../runMatch";

/**
 * ── F. ZERO-TOUCH BID ACCURACY (AUTOMATION-PLAN.md) ──
 *
 * The one number: open a keyed set, press NOTHING, and ask how far the bid is
 * from the key's bid priced the same way. Per labelled sheet:
 *
 *   ZERO-TOUCH — what reaches the estimate with no presses: wall runs the
 *   model does not hold off (`runsHeldOffEstimate`), after the app's own
 *   demolition comparison when the sheet auto-pairs (`autoPairs` +
 *   `priorPlanFor`, the same path `zzRenoCauses` exercises); doors with a
 *   printed mark (the auto-post door source); no windows posted (nothing
 *   clears their bar yet). Every zero-touch wall carries BOARD at the
 *   product's own height chain (#1157, `wallHeightChain`): the printed
 *   rule, else the company's TO_STRUCTURE / CEILING+6 / FIXED answer —
 *   with no room sides, since this eval runs no room finder.
 *
 *   TEN-PRESS — the same after the first N (default 10) review answers,
 *   answered FROM THE KEY in the shipped review order
 *   (`reviewOrder(…, "doubt")`): a posted junk run is removed, a held real
 *   run is added. Walls only in v1 — door and window questions are not
 *   simulated.
 *
 *   BID $ — one deterministic price table (PRICE below), applied identically
 *   to the run's quantities and the key's, so % off is about QUANTITIES,
 *   never price data. Key wall types are REPORTED for visibility, but v1
 *   prices every wall foot at one composite rate: with no presses nothing
 *   carries a confirmed type today, and a per-type price would charge the
 *   type gap twice.
 *
 * Training and held-out run separately (`ZT_HELD=1`). Held-out prints per-set
 * rows because the SCORE is per set — nothing here tunes anything. Needs
 * TAKEOFF_WALL_MODEL. Writes JSON rows to ZT_OUT and the table to stdout.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.ZT_OUT ?? "";
const HELD = process.env.ZT_HELD === "1";
const PRESSES = Number(process.env.ZT_PRESSES ?? "10");

/** v1 price table — placeholder composite rates, identical for run and key. */
/**
 * AUDITED 2026-11-13 (Diego): doors are priced per the company's door scope —
 * the DEFAULT is BY_OTHERS, under which the product bids $0 for doors on BOTH
 * sides, so doors leave the headline bid and causes and are reported per
 * setting instead. Windows price through the SAME scope setting (#1161):
 * at BY_OTHERS they bid $0 on both sides; at FRAMES or DOORS_AND_FRAMES a
 * key window nothing posted is UNDER money. ZT_DOOR_SCOPE overrides the
 * default.
 */
const PRICE = { wallPerLf: 18, boardPerSf: 2.2, doorEach: { BY_OTHERS: 0, FRAMES: 150, DOORS_AND_FRAMES: 350 }, windowEach: 150 } as const;
const DOOR_SCOPE = (process.env.ZT_DOOR_SCOPE ?? "BY_OTHERS") as keyof typeof PRICE.doorEach;
/**
 * #1157 ON THE RUN SIDE: the company answer the chain falls to when the set
 * prints no rule. Every trade preset creates companies TO_STRUCTURE with a
 * 10 ft usual height (trade-presets.ts), so that is the zero-touch default.
 */
const ANSWER = { convention: (process.env.ZT_HEIGHT_CONVENTION ?? "TO_STRUCTURE") as WallHeightConvention, fixedFt: Number(process.env.ZT_FIXED_FT ?? "10") };
/** #1161: windows price through the door/window scope — $0 at the BY_OTHERS default. */
const WINDOW_PRICE = DOOR_SCOPE === "BY_OTHERS" ? 0 : PRICE.windowEach;
/**
 * The trade's default partition assembly height, used to PRICE key board whose
 * type the heights key does not cover — applied the same way to both sides
 * (a run wall with no height still carries 0 until the product assigns one),
 * so board is in the headline rather than a footnote. The previously-unpriced
 * dollars and the type spellings that failed to match are reported.
 */
const NOMINAL_FEET = Number(process.env.ZT_DEFAULT_FEET ?? "9");
// ── PER-TYPE HEIGHTS, MEASURED ONCE (prereg-type-heights.md): both arms on the same tree ──
const TYPE_ROWS: Record<string, unknown>[] = [];
const LEGEND_CACHE = process.env.ZT_LEGEND_CACHE ?? "";
const typedBySet = new Map<string, { rules: Map<string, TypeHeightRule>; general: ReturnType<typeof generalTypeRule>; deck: Map<number, StoredDeckZones>; legendTypes: number }>();
/** The product's legend reader output for this PDF, cached per page (legend-cache: <stem>-p<N>-wall-legend.<v>.json). */
function cachedLegendTypes(pdf: string): { code: string; heightNote: string | null; lines: string[] }[] {
  if (LEGEND_CACHE === "" || !existsSync(LEGEND_CACHE)) return [];
  const stem = pdf.split("/").at(-1)!.replace(/[^A-Za-z0-9]+/g, "_");
  const byPage = new Map<string, string>();
  for (const n of readdirSync(LEGEND_CACHE)) {
    const m = new RegExp(`^${stem}-p(\\d+)-wall-legend\\.(\\d+)\\.json$`).exec(n);
    if (m === null) continue;
    const had = byPage.get(m[1]!);
    if (had === undefined || Number(/\.(\d+)\.json$/.exec(had)![1]) < Number(m[2])) byPage.set(m[1]!, n);
  }
  const out = new Map<string, { code: string; heightNote: string | null; lines: string[] }>();
  for (const n of byPage.values()) {
    const d = JSON.parse(readFileSync(join(LEGEND_CACHE, n), "utf8")) as { types?: { code: string; heightNote?: string; lines?: string[] }[] };
    for (const t of d.types ?? []) if (!out.has(t.code.toUpperCase())) out.set(t.code.toUpperCase(), { code: t.code, heightNote: t.heightNote ?? null, lines: t.lines ?? [] });
  }
  return [...out.values()];
}

/**
 * Heights for the board-SF term: heights-key sets → labelSet → type → feet.
 * A key run whose type the heights key covers carries LF × feet × 2 sides of
 * board; a zero-touch run carries board at the product's chain height
 * (#1157), so the board cause is now the HEIGHT GAP between the two sides,
 * not the whole term.
 */
const HEIGHTS = process.env.ZT_HEIGHTS ?? "";
// Key-side zoned pricing (Diego 2026-11-17): the full typed entries per labelSet, loaded through
// `loadKeyTypes` (keys uppercased, sameAs chains materialized to 5 hops — the flat loader's rules),
// priced per key wall by `keyWallFeet`: sheet zone, then room zone through the set's zone key
// (ZT_ZONE_KEYS "<labelSet>=<md path>,...", the coordination/*-room-parts-key.md files), then the
// scalar, then the default — with the default/unresolved walls still feeding the ZTBOARD worklist.
const keyTypesByLabelSet: Record<string, Record<string, HeightsKeyType>> = {};
const zoneKeyByLabelSet: Record<string, Map<string, RoomZone>> = {};
for (const pair of (process.env.ZT_ZONE_KEYS ?? "").split(",").filter((x) => x.includes("="))) {
  const at = pair.indexOf("=");
  const labelSet = pair.slice(0, at), path = pair.slice(at + 1);
  if (existsSync(path)) zoneKeyByLabelSet[labelSet] = parseRoomZoneKey(readFileSync(path, "utf8"));
}
if (HEIGHTS !== "" && existsSync(HEIGHTS)) {
  const hk = JSON.parse(readFileSync(HEIGHTS, "utf8")) as { sets?: Record<string, { labelSet?: string; types?: Record<string, HeightsKeyType> }> };
  for (const one of Object.values(hk.sets ?? {})) {
    if (one.labelSet === undefined) continue;
    keyTypesByLabelSet[one.labelSet] = loadKeyTypes(one.types ?? {});
  }
}

/**
 * THE RUN MODEL, AS THE PRODUCT RUNS IT (#1179): set TAKEOFF_WALL_RUN_MODEL and every kept run
 * the hand chain posts but the model scores below 0.10 is held off the zero-touch estimate —
 * the remove-only rule, measured here so the junk-walls cause answers Diego's question. The
 * totals print ON/OFF so a run can never be silently vacuous about which arm it measured.
 */
const RUN_MODEL = loadRunModel(process.env);

const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & Parameters<typeof wallTestFromLabels>[0] & { page: number; feetPerUnit: number };

async function sheetsOf(pdf: string): Promise<{ pageNumber: number; sheetNumber: string | null; title: string | null }[]> {
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const proposals = new Map<number, SheetProposalRow>();
  const work = pageInventoryWork(
    { planId: "p", companyId: "c", ingestJobId: "i", jobId: "j", startedByUserId: null },
    {
      readPlanBytes: async () => ({ ok: true, bytes: Buffer.from("") }),
      openPdf: async () => doc,
      saveSheetText: async () => {},
      saveScaleReading: async () => {},
      saveSheetProposal: async (r) => void proposals.set(r.pageNumber, r),
      sheetNamesOn: async () => true,
    },
  );
  for (let page = 1; page <= doc.pageCount; page += 1) {
    try {
      await work({ id: `t${page}`, pageNumber: page, stage: "PAGE_INVENTORY", attempts: 0 } as never);
    } catch {
      // an unreadable page is not paired
    }
  }
  await doc.close();
  return [...proposals.values()].map((p) => ({ pageNumber: p.pageNumber, sheetNumber: p.sheetNumber, title: p.title }));
}

const bid = (q: { lf: number; boardSf?: number; doors: number; windows?: number }) => q.lf * PRICE.wallPerLf + (q.boardSf ?? 0) * PRICE.boardPerSf + q.doors * PRICE.doorEach[DOOR_SCOPE] + (q.windows ?? 0) * WINDOW_PRICE;

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("zero-touch bid accuracy", () => {
  it("prices the untouched takeoff against the key", { timeout: 14_400_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    /**
     * LOSO (METHOD v2): ZT_LOSO_DIR holds one model per label set, named <labelSet>.json,
     * each trained WITHOUT that set. The set is scored with its own fold model; a set with
     * no fold file is SKIPPED and listed — using the global model there would leak the
     * set's own training signal into a number everyone reads as out-of-sample.
     */
    const LOSO_DIR = process.env.ZT_LOSO_DIR ?? "";
    const losoSkipped: string[] = [];
    const rows: Record<string, unknown>[] = [];
    const unmatchedSpellings: Record<string, number> = {};
    const planHeightsBySet = new Map<string, { rule: SetHeightRule | null; figures: Omit<SetFigures, "floorToFloorFt">; marks: LevelMark[]; roofs: Map<number, StoredRoofParts>; ceilingPages: CeilingPageText[] }>();
    // #1198 wired: instrument counters for the ROOMSIDES line (one group per process).
    let rsRooms = 0, rsWalls = 0, rsMoved = 0;
    let kzSheet = 0, kzRoom = 0, kzUnresolved = 0;
    const bySet = new Map<string, { lf: number; doors: number; windows: number; lf10: number; keyLf: number; keyDoors: number; keyWindows: number; keyByType: Record<string, number>; sheets: number; junkLf: number; junkRenoLf: number; missedLf: number; keyBoardSf: number; renovation: boolean; doorsOver: number; unpricedBoardSf: number; zeroBoardSf: number; lf10BoardSf: number; needsAnswerLf: number; noBoardLf: number }>();
    for (const dir of readdirSync(LABELS).sort()) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
      if (process.env.ZT_ONLY !== undefined && !dir.includes(process.env.ZT_ONLY)) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      let setConfig = config;
      if (LOSO_DIR !== "") {
        const foldPath = join(LOSO_DIR, `${dir}.json`);
        if (!existsSync(foldPath)) { losoSkipped.push(dir); continue; }
        const fold = loadWallModel({ ...process.env, TAKEOFF_WALL_MODEL: foldPath });
        if (fold === null) throw new Error(`LOSO fold model unreadable: ${foldPath}`);
        setConfig = fold;
      }
      const sheetsAll = await sheetsOf(pdf);
      const auto = autoPairs(sheetsAll);
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        // feetPerUnit turns on the overlap fold: two accepted rows on one wall
        // (one from an older finder version) count once, never twice.
        const got = keyFromLabels(saved, saved.feetPerUnit);
        const key = got.key;
        const keyDoors = got.openings.filter((o) => o.kind === "door").length;
        const keyWindows = got.openings.filter((o) => o.kind === "window").length;
        if (key.length === 0 && keyDoors === 0 && keyWindows === 0) continue;
        // A label whose wall review never ran (door keys only, candidates left
        // unreviewed) is not a wall test — see wallTestFromLabels. Its door
        // and window keys still count below; its WALL and BOARD terms are
        // zeroed at the accumulation, or everything the product posts would
        // price as pure over against a key nobody made.
        // An enlarged-plan sheet prices no wall LF (Diego's ruling, BOARD.md
        // 2026-11-19): same zeroing as a sheet whose wall review never ran,
        // and doors/windows/types still count.
        const enlargedWhy = enlargedPlanReason(dir, sheet);
        const wallTest = wallTestFromLabels(saved) && enlargedWhy === null;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const scored: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const offer = (priorPlan?: { lines: NonNullable<ReturnType<typeof priorPlanFor>["lines"]>; sheet: string }) =>
          offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems, ...(priorPlan === undefined ? {} : { priorPlan }) }).offeredRuns;
        const runsBefore = offer();
        let runs = runsBefore;
        let runPrior: ReturnType<typeof priorForRuns>;
        let paired = "-";
        const pair = auto.get(saved.page);
        if (pair !== undefined) {
          const ds = await doc.pageStrokes(pair.demoPage);
          const dt = (await doc.pageText(pair.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const prior = priorPlanFor({ demo: { segments: ds.segments, textItems: dt, widthPt: ds.widthPt, heightPt: ds.heightPt }, newPage: { segments: strokes.segments, widthPt: W }, newRuns: runs, feetPerUnit: fpu });
          paired = `p${pair.demoPage}`;
          if (prior.lines !== null) runs = offer({ lines: prior.lines, sheet: `p${pair.demoPage}` });
          if (prior.lines !== null) runPrior = priorForRuns(prior, { segments: ds.segments, widthPt: ds.widthPt }, fpu, W);
        }
        // Doors with a printed mark: the auto-post class. Schedule rows are a
        // DB read this eval does not make; the mark comes off the drawing.
        const dw = doorsAndWindowsForSheet({ segments: d.found.inUnits, segmentsPt: strokes.segments, textPt: textItems, widthPt: W, walls: d.found.walls, feetPerUnit: fpu, scheduleRows: [] });
        // A sheet whose key holds no door (or window) marks cannot score them: posted doors there are
        // neither over nor under, they are unkeyed. Only door-keyed sheets enter the door terms.
        const postedDoors = keyDoors === 0 ? 0 : dw.doorMarks.filter((m) => m !== null && m.trim() !== "").length;
        const held = new Set(runsHeldOffEstimate(setConfig.model, runs, scored, fpu, false));
        // Remove-only, exactly the product's call (detectWallsForCalibration): posted + score < 0.10 -> held.
        if (RUN_MODEL !== null) {
          const verdicts = runModelVerdicts({ offered: runsBefore, kept: runs, pairings: scored, pairModel: setConfig.model, segments: strokes.segments, textItems, widthPt: W, feetPerUnit: fpu, ...(runPrior === undefined ? {} : { prior: runPrior }) }, RUN_MODEL);
          for (const r of verdicts.removed) held.add(r);
        }
        const zeroLf = runs.reduce((n, r) => n + (held.has(r) ? 0 : r.lengthFeet), 0);
        // N presses, answered from the key, in the shipped order.
        const junk = runs.map((r) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet >= 0.5 * r.lengthFeet);
        const scores = runScores(setConfig.model, runs, scored, fpu);
        const entries = runs.map((r, at) => ({ at, held: held.has(r), score: scores[at] ?? null, lengthFeet: r.lengthFeet }));
        let lf10 = zeroLf;
        let answered = 0;
        const flips: { r: (typeof runs)[number]; sign: number }[] = [];
        for (const at of reviewOrder(entries, "doubt")) {
          if (answered >= PRESSES) break;
          answered += 1;
          const r = runs[at]!;
          if (!held.has(r) && junk[at]) { lf10 -= r.lengthFeet; flips.push({ r, sign: -1 }); }
          if (held.has(r) && !junk[at]) { lf10 += r.lengthFeet; flips.push({ r, sign: 1 }); }
        }
        // ── #1157: THE PRODUCT'S HEIGHT FOR EVERY ZERO-TOUCH WALL (no room sides here) ──
        let ph = planHeightsBySet.get(dir);
        if (ph === undefined) {
          const facts = await setHeightFacts(doc, { legendPage: 0, maxPages: 120 });
          const rule = setHeightRule(facts.generalNote, facts.facts);
          const figs = setFigures(facts.facts, null);
          // #1198 wired: the set's roof parts and ceiling pages, once, for the per-wall chain below.
          const roofs = rule?.kind === "to-structure-by-roof" ? await roofPartsFor(doc, facts) : new Map<number, StoredRoofParts>();
          const ceilingPages: CeilingPageText[] = [];
          for (let n = 1; n <= Math.min(doc.pageCount, 160) && ceilingPages.length < 40; n += 1) {
            const page = await doc.pageText(n).catch(() => null);
            if (!page || !CEILING_PAGE_TITLE.test(page.items.map((i) => i.str).join(" "))) continue;
            const cs = await doc.pageStrokes(n).catch(() => null);
            ceilingPages.push({ pageNumber: n, items: page.items, widthPt: page.widthPt, tableRows: tableRowsFromPage(page), strokes: cs?.segments.map((g) => ({ x1: g.x1 / cs.widthPt, y1: g.y1 / cs.widthPt, x2: g.x2 / cs.widthPt, y2: g.y2 / cs.widthPt })) });
          }
          ph = { rule, figures: { structureFt: figs.structureFt, setCeilingFt: figs.setCeilingFt }, marks: facts.levels ?? [], roofs, ceilingPages };
          planHeightsBySet.set(dir, ph);
          const legendTypes = cachedLegendTypes(pdf);
          const rules = new Map<string, TypeHeightRule>();
          for (const t of legendTypes) { const r = typeHeightRule(t, facts); if (r !== null) rules.set(t.code.toUpperCase(), r); }
          const notes = [facts.generalNote?.text ?? "", ...facts.facts.filter((f) => f.kind === "general-note" || f.kind === "note").map((f) => f.text ?? f.phrase ?? "")];
          const general = generalTypeRule(notes, facts.facts);
          const forPages = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(LABELS, dir, n), "utf8")) as { page: number; feetPerUnit: number }).filter((d) => d.page > 0 && d.feetPerUnit > 0).map((d) => ({ page: d.page, feetPerUnit: d.feetPerUnit }));
          const deck = await deckZonesFor(doc, null, forPages);
          typedBySet.set(dir, { rules, general, deck, legendTypes: legendTypes.length });
        }
        const pageLevels = sheetViews(text.items, W).map((v) => planLevels(v.name)).find((l) => l.length > 0) ?? [];
        const figures: SetFigures = { floorToFloorFt: levelHeight(ph.marks, pageLevels)?.feet ?? null, ...ph.figures };
        const chain = wallHeightChain(ph.rule, [null, null], [null, null], ANSWER, figures);
        const chainFeet = chain?.feet ?? 0;
        // ── #1198 WIRED: EACH RUN WALL'S OWN ROOMS, THE PRODUCT'S PROBE AND CHAIN (`wallChainWithRooms`) ──
        // Rooms close from the walls zero-touch POSTS (held runs out), as the product's room finder
        // would see them; ceilings from the set's ceiling plans; the roof over each room under a
        // to-structure-by-roof rule. A wall beside no room falls through the same chain to the same
        // set-level answer as before, so this is a strict refinement of the #1157 behavior.
        const kept = runs.filter((r) => !held.has(r));
        // The product's own tag groups (`found.regroup`): each kept run's wall-type code, when its group is a tag's.
        const runCode = new Map<(typeof runs)[number], string>();
        for (const g of d.found.regroup(kept as never)) if (g.source.kind === "TAG") for (const r of g.runs) runCode.set(r as never, g.source.tag.toUpperCase());
        const unitSegments = strokes.segments.map((g) => ({ ...g, x1: g.x1 / W, y1: g.y1 / W, x2: g.x2 / W, y2: g.y2 / W }));
        const foundRooms = sheetRooms({ pairings: [], runs: kept.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, thicknessFeet: r.thicknessFeet })) as never, drawn: [], segments: unitSegments, doorLeaves: [], feetPerUnit: fpu, text: text.items, widthPt: W });
        const ceilings = ceilingsForRooms({ rooms: foundRooms.rooms, current: { pageNumber: saved.page, items: text.items, widthPt: W, tableRows: tableRowsFromPage(text) }, feetPerUnit: fpu, others: ph.ceilingPages.filter((g) => g.pageNumber !== saved.page) });
        const roof = ph.roofs.get(saved.page);
        rsRooms += foundRooms.rooms.length;
        const feetByRun = new Map<(typeof runs)[number], number>();
        const runFeet = (r: (typeof runs)[number]): number => {
          const had = feetByRun.get(r);
          if (had !== undefined) return had;
          const h = wallChainWithRooms({
            wall: { xs: [r.x1, r.x2], ys: [r.y1, r.y2] },
            rooms: foundRooms.rooms,
            ceilingOf: (room) => ceilings.get(room.id)?.heightFeet ?? null,
            namedOf: (room) => room.tag !== null,
            roofMask: roof?.mask,
            rule: ph.rule,
            answer: ANSWER,
            figures,
          });
          const f = h?.feet ?? 0;
          rsWalls += 1;
          if (f !== chainFeet) rsMoved += 1;
          feetByRun.set(r, f);
          return f;
        };
        const zeroBoardSf = kept.reduce((n, r) => n + r.lengthFeet * runFeet(r) * 2, 0);
        let lf10BoardSf = zeroBoardSf;
        for (const fl of flips) lf10BoardSf += fl.sign * fl.r.lengthFeet * runFeet(fl.r) * 2;
        await doc.close();
        const keyLf = key.reduce((n, k) => n + k.lengthFeet, 0);
        const words = textItems.map((t) => t.str).join(" ");
        const renovation = /\(E\)/i.test(words) || (words.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
        let junkLf = 0;
        for (let at = 0; at < runs.length; at += 1) if (!held.has(runs[at]!) && junk[at]) junkLf += runs[at]!.lengthFeet;
        const missedLf = Math.max(0, keyLf - (zeroLf - junkLf));
        const keyTypes = keyTypesByLabelSet[dir] ?? {};
        const zoneKey = zoneKeyByLabelSet[dir] ?? null;
        // Rooms for the KEY walls, only when this set's key has a room-kind zone to resolve: rooms
        // close from the LABELLED walls (as zzZonedHeights — wall finding is not what is priced here).
        const keyHasRoomZones = Object.values(keyTypes).some((t) => (t.zones ?? []).some((z) => z.kind !== "sheet"));
        let keyWallRooms: ((k: (typeof key)[number]) => (string | null)[]) = () => [];
        if (keyHasRoomZones && zoneKey !== null) {
          const keyFound = sheetRooms({ pairings: [], runs: key.map((k) => ({ x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2, thicknessFeet: k.thicknessFeet ?? 0.5 })) as never, drawn: [], segments: unitSegments, doorLeaves: [], feetPerUnit: fpu, text: text.items, widthPt: W });
          keyWallRooms = (k) => wallSideRooms({ xs: [k.x1, k.x2], ys: [k.y1, k.y2] }, keyFound.rooms).map((r) => r?.tag?.number ?? null);
        }
        let keyBoardSf = 0;
        let defaultedBoardSf = 0;
        // H4/H5 (Diego 2026-11-19): needs-answer walls (height unknowable from
        // the documents) and no-board walls (bare CMU) price NO board on the
        // key side (keyWallFeet returns feet 0), and the SAME share leaves the
        // posted side below — a key the documents cannot price must not charge
        // the product for pricing it either way.
        let needsAnswerLf = 0;
        let noBoardLf = 0;
        for (const k of key) {
          const t = (((k as { wallType?: string }).wallType ?? "").trim()).toUpperCase();
          const r = keyWallFeet({ code: t, types: keyTypes, sheet, sideRoomNumbers: keyWallRooms(k), zoneKey, defaultFeet: NOMINAL_FEET });
          keyBoardSf += k.lengthFeet * r.feet * 2;
          {
            // OFF: today's chain at this key wall. ON: the type rule of the posted run lying on it.
            const geo = { xs: [k.x1, k.x2], ys: [k.y1, k.y2] };
            const off = wallChainWithRooms({ wall: geo, rooms: foundRooms.rooms, ceilingOf: (room) => ceilings.get(room.id)?.heightFeet ?? null, namedOf: (room) => room.tag !== null, roofMask: roof?.mask, rule: ph.rule, answer: ANSWER, figures });
            const typed = typedBySet.get(dir)!;
            let best: { code: string | null; o: number } = { code: null, o: 0 };
            for (const run of kept) {
              const o = wallOverlapFeet(run, k, fpu);
              if (o !== null && o > best.o) best = { code: runCode.get(run) ?? null, o };
            }
            const sides = wallSideCeilings(geo, foundRooms.rooms, (room) => ceilings.get(room.id)?.heightFeet ?? null);
            const zones = typed.deck.get(saved.page);
            const on = wallHeightByType({ code: best.code, rules: typed.rules, general: typed.general, sideCeilings: sides, setCeilingFt: figures.setCeilingFt, deck: zones === undefined ? null : { zones: zones.zones, at: { x: (k.x1 + k.x2) / 2, y: (k.y1 + k.y2) / 2 }, feetPerUnit: fpu } });
            const onFeet = on === null ? off?.feet ?? 0 : on.kind === "height" ? on.feet : on.kind === "no-board" ? 0 : off?.feet ?? 0;
            TYPE_ROWS.push({ set: dir, sheet, w: wallTestFromLabels(saved) ? 1 : 0, keyType: t, lf: k.lengthFeet, keyFeet: r.feet, keyFrom: r.from, offFeet: off?.feet ?? 0, offFrom: off?.from ?? null, prodCode: best.code, onKind: on === null ? "fallthrough" : on.kind, onFeet, onFrom: on === null ? null : on.kind === "height" ? on.from : on.why });
          }
          if (r.from === "sheet-zone") kzSheet += 1;
          if (r.from === "room-zone") kzRoom += 1;
          if (r.from === "zone-unresolved") kzUnresolved += 1;
          if (r.from === "needs-answer") needsAnswerLf += k.lengthFeet;
          if (r.from === "no-board") noBoardLf += k.lengthFeet;
          if (r.from === "default" || r.from === "zone-unresolved") {
            defaultedBoardSf += k.lengthFeet * NOMINAL_FEET * 2;
            if (t !== "" && t !== "0" && t !== "U") unmatchedSpellings[`${dir.slice(0, 18)}:${t}`] = (unmatchedSpellings[`${dir.slice(0, 18)}:${t}`] ?? 0) + k.lengthFeet;
          }
        }
        const unpricedBoardSf = defaultedBoardSf;
        // The posted-side share for the excluded walls, at this eval's own
        // set-level granularity: the excluded fraction of the key's LF, taken
        // off the posted board at the sheet's average posted height. Coarse by
        // design — the eval matches LF per sheet, not wall-to-wall — and said
        // here rather than discovered in a diff.
        const exclFraction = keyLf > 0 ? Math.min(1, (needsAnswerLf + noBoardLf) / keyLf) : 0;
        const zeroBoardSfAdj = zeroBoardSf * (1 - exclFraction);
        const lf10BoardSfAdj = lf10BoardSf * (1 - exclFraction);
        const keyByType: Record<string, number> = {};
        for (const k of key) {
          const t = ((k as { wallType?: string }).wallType ?? "0").trim() || "0";
          keyByType[t] = Math.round(((keyByType[t] ?? 0) + k.lengthFeet) * 10) / 10;
        }
        const s = bySet.get(dir) ?? { lf: 0, doors: 0, windows: 0, lf10: 0, keyLf: 0, keyDoors: 0, keyWindows: 0, keyByType: {}, sheets: 0, junkLf: 0, junkRenoLf: 0, missedLf: 0, keyBoardSf: 0, renovation: false, doorsOver: 0, unpricedBoardSf: 0, zeroBoardSf: 0, lf10BoardSf: 0, needsAnswerLf: 0, noBoardLf: 0 };
        // Not a wall test: every wall/board term is zeroed, doors/windows stay.
        const w = wallTest ? 1 : 0;
        s.lf += zeroLf * w; s.lf10 += lf10 * w; s.doors += Math.min(postedDoors, keyDoors); s.doorsOver += Math.max(0, postedDoors - keyDoors); s.keyLf += keyLf * w; s.keyDoors += keyDoors; s.keyWindows += keyWindows; s.sheets += 1; s.junkLf += junkLf * w; if (renovation) s.junkRenoLf += junkLf * w; s.missedLf += missedLf * w; s.keyBoardSf += keyBoardSf * w; s.unpricedBoardSf += unpricedBoardSf * w; s.zeroBoardSf += zeroBoardSfAdj * w; s.lf10BoardSf += lf10BoardSfAdj * w; s.needsAnswerLf += needsAnswerLf * w; s.noBoardLf += noBoardLf * w; s.renovation = s.renovation || (renovation && wallTest);
        if (wallTest) for (const [t, ft] of Object.entries(keyByType)) s.keyByType[t] = Math.round(((s.keyByType[t] ?? 0) + ft) * 10) / 10;
        bySet.set(dir, s);
        rows.push({ set: dir, sheet, paired, renovation, keyLf: Math.round(keyLf * w), zeroLf: Math.round(zeroLf * w), lf10: Math.round(lf10 * w), junkLf: Math.round(junkLf * w), missedLf: Math.round(missedLf * w), keyBoardSf: Math.round(keyBoardSf * w), unpricedBoardSf: Math.round(unpricedBoardSf * w), zeroBoardSf: Math.round(zeroBoardSfAdj * w), chainFeet, chainFrom: chain?.from ?? null, rooms: foundRooms.rooms.length, keyDoors, postedDoors, keyWindows });
        if (enlargedWhy !== null) console.log(`ZT ${HELD ? "HELD-OUT" : "TRAINING"} ${dir.slice(0, 26)} ${sheet}: ENLARGED PLAN — wall and board terms excluded (enlargedPlanReason)`);
        else if (!wallTest) console.log(`ZT ${HELD ? "HELD-OUT" : "TRAINING"} ${dir.slice(0, 26)} ${sheet}: wall review never ran (door/window keys only) — wall and board terms excluded (wallTestFromLabels)`);
      }
    }
    const group = HELD ? "HELD-OUT" : "TRAINING";
    console.log(`ZT RUNMODEL ${group}: ${RUN_MODEL === null ? "OFF (TAKEOFF_WALL_RUN_MODEL unset)" : "ON (remove-only below 0.10)"}`);
    console.log(`ZT ROOMSIDES ${group}: ON — rooms ${rsRooms} · run walls ${rsWalls} · heights moved by room sides ${rsMoved}`);
    console.log(`ZT KEYZONES ${group}: ON — key walls priced sheet-zone ${kzSheet} · room-zone ${kzRoom} · zone-unresolved ${kzUnresolved}`);
    let zb = 0, kb = 0, tb = 0;
    let totalErr = 0;
    const cause = { junkNew: 0, junkReno: 0, missed: 0, board: 0, doors: 0, windows: 0, doorsOver: 0, doorsAtFrames: 0, doorsAtFull: 0, windowsInfo: 0, unpricedBoard: 0 };
    for (const [dir, s] of [...bySet.entries()].sort()) {
      const kBid = bid({ lf: s.keyLf, boardSf: s.keyBoardSf, doors: s.keyDoors, windows: s.keyWindows });
      const boardOverSf = Math.max(0, s.zeroBoardSf - s.keyBoardSf);
      const boardUnderSf = Math.max(0, s.keyBoardSf - s.zeroBoardSf);
      const setOver = s.junkLf * PRICE.wallPerLf + s.doorsOver * PRICE.doorEach[DOOR_SCOPE] + boardOverSf * PRICE.boardPerSf;
      const setUnder = s.missedLf * PRICE.wallPerLf + boardUnderSf * PRICE.boardPerSf + Math.max(0, s.keyDoors - s.doors) * PRICE.doorEach[DOOR_SCOPE] + s.keyWindows * WINDOW_PRICE;
      totalErr += setOver + setUnder;
      cause.junkNew += (s.junkLf - s.junkRenoLf) * PRICE.wallPerLf;
      cause.junkReno += s.junkRenoLf * PRICE.wallPerLf;
      cause.missed += s.missedLf * PRICE.wallPerLf;
      cause.board += (boardOverSf + boardUnderSf) * PRICE.boardPerSf;
      cause.windows += s.keyWindows * WINDOW_PRICE;
      cause.doors += Math.max(0, s.keyDoors - s.doors) * PRICE.doorEach[DOOR_SCOPE];
      cause.doorsAtFrames += Math.max(0, s.keyDoors - s.doors) * PRICE.doorEach.FRAMES;
      cause.doorsAtFull += Math.max(0, s.keyDoors - s.doors) * PRICE.doorEach.DOORS_AND_FRAMES;
      cause.unpricedBoard += s.unpricedBoardSf;
      cause.doorsOver += s.doorsOver * PRICE.doorEach[DOOR_SCOPE];
      cause.windowsInfo += s.keyWindows * PRICE.windowEach;
      const zBid = bid({ lf: s.lf, boardSf: s.zeroBoardSf, doors: s.doors });
      const tBid = bid({ lf: s.lf10, boardSf: s.lf10BoardSf, doors: s.doors });
      zb += zBid; kb += kBid; tb += tBid;
      const pct = (x: number) => (kBid === 0 ? "—" : `${(((x - kBid) / kBid) * 100).toFixed(1)}%`);
      const totErr = kBid === 0 ? "—" : `${(((setOver + setUnder) / kBid) * 100).toFixed(1)}%`;
      console.log(
        `ZT ${group} ${dir.slice(0, 26).padEnd(26)} sheets ${s.sheets} · key LF ${Math.round(s.keyLf)} doors ${s.keyDoors} windows ${s.keyWindows} · ` +
          `zero LF ${Math.round(s.lf)} doors ${s.doors} windows 0 · TOTAL ERROR ${totErr} (over $${Math.round(setOver)} + under $${Math.round(setUnder)}) · net ${pct(zBid)} · after ${PRESSES} presses ${pct(tBid)} · key types ${JSON.stringify(s.keyByType)}`,
      );
    }
    if (kb > 0) console.log(`ZT ${group} TOTAL bid off ${(((zb - kb) / kb) * 100).toFixed(1)}% zero-touch · ${(((tb - kb) / kb) * 100).toFixed(1)}% after ${PRESSES} presses/sheet (key $${Math.round(kb)})`);
    if (LOSO_DIR !== "") {
      console.log(`ZT MODE LOSO: per-set fold models from ${LOSO_DIR} · ${bySet.size} sets scored · ${losoSkipped.length} skipped (no fold model)${losoSkipped.length > 0 ? ": " + losoSkipped.map((d) => d.slice(0, 24)).join(", ") : ""}`);
      console.log(`ZT MODE LOSO: pooled figures below cover ONLY the ${bySet.size} fold-covered sets; the fixed held-out sets remain the final exam, run once per release`);
    }
    // HEADLINE: TOTAL ERROR = (|over| + |under|) / key — cancelling must never look like accuracy (Diego).
    if (kb > 0) console.log(`ZT ${group} TOTAL ERROR ${((totalErr / kb) * 100).toFixed(1)}% of key $${Math.round(kb)} — the headline; net is secondary`);
    // OVER and UNDER separately, so junk cuts and recovered quantities cannot hide each other (Diego).
    const over = cause.junkNew + cause.junkReno + cause.doorsOver;
    const under = cause.missed + cause.board + cause.doors + cause.windows;
    if (kb > 0) console.log(`ZT ${group} OVER $${Math.round(over)} (+${((over / kb) * 100).toFixed(1)}% of key) · UNDER $${Math.round(under)} (-${((under / kb) * 100).toFixed(1)}%) · net ${(((zb - kb) / kb) * 100).toFixed(1)}%`);
    // Dollars by cause, ranked. "wrong type" prices at $0 in v2 (one composite wall rate, and
    // nothing posts typed with zero presses) — the types gap is the canonical type scorer's to
    // report in feet until per-type prices exist. "board (no height)" is the whole board term,
    // because no height is assigned with zero presses today; it shrinks as D lands.
    const named: [string, number][] = [
      ["junk walls posted (new build)", cause.junkNew],
      ["existing walls counted on renovations (junk on reno sheets)", cause.junkReno],
      ["missed walls", cause.missed],
      ["board height gap (run chain height vs key heights)", cause.board],
      [`doors not posted (at the company scope ${DOOR_SCOPE})`, cause.doors],
      [`windows not posted (at the company scope ${DOOR_SCOPE})`, cause.windows],
      ["doors posted beyond the key", cause.doorsOver],
    ];
    const err = Math.abs(zb - kb);
    const sum = named.reduce((n, [, v]) => n + Math.abs(v), 0);
    named.push(["other (residual vs |total error|)", Math.max(0, err - sum)]);
    for (const [label, v] of [...named].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
      console.log(`ZTCAUSE ${group} $${Math.round(Math.abs(v))} · ${label}`);
    }
    {
      const naLf = [...bySet.values()].reduce((n, x) => n + x.needsAnswerLf, 0);
      const nbLf = [...bySet.values()].reduce((n, x) => n + x.noBoardLf, 0);
      const refDollars = Math.round(naLf * NOMINAL_FEET * 2 * PRICE.boardPerSf);
      if (naLf > 0) console.log(`ZT ${group} HEIGHT NEEDS CONTRACTOR ANSWER: ${Math.round(naLf)} LF ($${refDollars} at the ${NOMINAL_FEET}' company-answer default, for reference — excluded from board $ on both sides per H4)`);
      if (nbLf > 0) console.log(`ZT ${group} NO-BOARD TYPES (bare CMU, H5): ${Math.round(nbLf)} LF — excluded from board $`);
    }
    console.log(`ZTDOORS ${group} by scope: BY_OTHERS $0 · FRAMES $${Math.round(cause.doorsAtFrames)} · DOORS_AND_FRAMES $${Math.round(cause.doorsAtFull)} (headline uses ${DOOR_SCOPE}, the product default)`);
    console.log(`ZTWINDOWS ${group} by scope (#1161, windows price through the door/window scope): BY_OTHERS $0 · FRAMES/DOORS_AND_FRAMES $${Math.round(cause.windowsInfo)} at $${PRICE.windowEach}/each (headline uses ${DOOR_SCOPE}, the product default)`);
    console.log(`ZTBOARD ${group} run board PRICED via the product height chain (#1157; run-side room sides wired, #1198); key types with no heights-key match at the default ${NOMINAL_FEET}': ${Math.round(cause.unpricedBoard)} SF = $${Math.round(cause.unpricedBoard * PRICE.boardPerSf)} · type spellings with no heights-key match (ft): ${JSON.stringify(Object.fromEntries(Object.entries(unmatchedSpellings).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v)])))}`);
    writeFileSync(OUT, JSON.stringify({ group, prices: PRICE, cause, rows }, null, 1));
    if (process.env.ZT_TYPE_OUT) writeFileSync(process.env.ZT_TYPE_OUT, JSON.stringify({ group, sets: Object.fromEntries([...typedBySet].map(([k, v]) => [k, { rules: Object.fromEntries(v.rules), general: v.general, legendTypes: v.legendTypes, deckPages: [...v.deck.keys()] }])), rows: TYPE_ROWS }));
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
  });
});
