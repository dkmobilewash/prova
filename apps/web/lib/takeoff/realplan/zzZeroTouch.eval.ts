import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { runsHeldOffEstimate } from "../estimateHold";
import { codePlanTitle, enlargedPlanReason, excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, uncoveredFeet, wallTestFromLabels, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { priorPlanFor } from "../priorPlan";
import { autoPairs } from "../priorPlanLoad";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import { loadRenoModel, loadRunModel, priorForRuns, renoModelRemovals, runModelVerdicts } from "../wallRunModel";
import { reviewOrder, runScores } from "../wallReview";
import type { WallCandidate } from "../wallVectors";
import { clipToWorkArea, eraseInBoxes, wallsLikeThese, type Polygon } from "../userExclusions";
import { actionsToExact, postureChoice, postureFeet, type ActionsInput } from "../actionsToExact";
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
import { wallSideRooms } from "../wallSides";
import { sheetViews } from "../sheetViews";

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
/**
 * R, THE PAIRED-RENOVATION MODEL, AS DETECTION RUNS IT (`detectWallsForCalibration.ts`): set
 * TAKEOFF_WALL_RENO_MODEL and, on a renovation sheet paired with its demolition plan, every kept run
 * the hand chain posts and R scores below 0.10 is held off too — a run either model removes is held.
 * Missing from this eval until 2026-11-19, so its paired-renovation junk counted walls the product
 * holds. The totals print ON/OFF for the same reason as the run model's.
 */
const RENO_MODEL = loadRenoModel(process.env);

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
    // ── ZTENV BANNER (Diego's env-audit order, 2026-11-26): the EFFECTIVE state of
    // every flag and input this eval depends on, printed before anything runs. Exam 3
    // ran NOT-DRAWING OFF because a script exported the bare TAKEOFF_NOT_DRAWING while
    // the code reads only NEXT_PUBLIC_TAKEOFF_NOT_DRAWING — nobody could see it in the
    // log. Now the log says what RAN, not what the command meant.
    {
      const { createHash } = await import("node:crypto");
      const sha8 = (p: string | undefined) => {
        if (!p) return "unset";
        try { return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 8); } catch { return "UNREADABLE"; }
      };
      const flag = (v: string | undefined) => (v === "1" ? "ON" : v === undefined ? "unset" : `"${v}"`);
      // NOT_DRAWING is imported state in offeredCandidates; report the SAME read the
      // product performs, plus the bare name so a wrong export is visible by contrast.
      console.log(`ZTENV NOT_DRAWING effective=${process.env.NEXT_PUBLIC_TAKEOFF_NOT_DRAWING === "1" ? "ON" : "OFF"} (NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=${flag(process.env.NEXT_PUBLIC_TAKEOFF_NOT_DRAWING)}; bare TAKEOFF_NOT_DRAWING=${flag(process.env.TAKEOFF_NOT_DRAWING)} — the bare name is READ BY NOTHING)`);
      console.log(`ZTENV RENO_UNPAIRED=${flag(process.env.TAKEOFF_RENO_UNPAIRED)} · ZT_HELD=${flag(process.env.ZT_HELD)} · PRESSES=${PRESSES}`);
      for (const name of ["TAKEOFF_WALL_MODEL", "TAKEOFF_WALL_RUN_MODEL", "TAKEOFF_WALL_RENO_MODEL", "TAKEOFF_WALL_RENO_ALL_MODEL"] as const) {
        console.log(`ZTENV ${name}=${process.env[name] ?? "unset"} sha ${sha8(process.env[name])}`);
      }
      console.log(`ZTENV ZT_HEIGHTS=${HEIGHTS || "unset"} sha ${sha8(HEIGHTS || undefined)} · ZT_LEGEND_CACHE=${process.env.ZT_LEGEND_CACHE ?? "unset"} · ZT_ZONE_KEYS=${process.env.ZT_ZONE_KEYS ?? "unset"}`);
      console.log(`ZTENV ZT_JUNKDUMP=${process.env.ZT_JUNKDUMP ?? "unset"} · ZT_LOSO_DIR=${process.env.ZT_LOSO_DIR ?? "unset"} · ZT_ONLY=${process.env.ZT_ONLY ?? "unset"}`);
    }
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
    const bySet = new Map<string, { lf: number; doors: number; windows: number; lf10: number; keyLf: number; keyDoors: number; keyWindows: number; keyByType: Record<string, number>; sheets: number; junkLf: number; junkRenoLf: number; missedLf: number; keyBoardSf: number; renovation: boolean; doorsOver: number; unpricedBoardSf: number; zeroBoardSf: number; lf10BoardSf: number; needsAnswerLf: number; noBoardLf: number; revLf: number; rev10Lf: number; revJunkLf: number; revMissedLf: number; revBoardSf: number; rev10BoardSf: number; junkBoardSf: number; gradedKeyLf: number; defaultedBoardSf: number; a2Lf: number; a2JunkLf: number; a2MissedLf: number; a2JunkBoardSf: number; a2RealGradedSf: number; a2DefaultPostedSf: number; keyGradedBoardSf: number; keyDefaultBoardSf: number }>();
    // Scoreboard v3 (prereg-scoreboard-v3.md): one row per scored sheet for ACTIONS TO EXACT.
    const v3Sheets: { group: string; set: string; sheet: string; actions: number; B: number; X: number; E: number; J: number; L: number; R: number; M: number; H: number }[] = [];
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
        // and doors/windows/types still count. A code/life-safety/egress plan
        // likewise (BOARD.md 2026-11-21): it repeats the architectural floor.
        const enlargedWhy = enlargedPlanReason(dir, sheet);
        const codePlan = codePlanTitle(sheetsAll.find((s) => s.pageNumber === saved.page)?.title ?? null);
        const wallTest = wallTestFromLabels(saved) && enlargedWhy === null && !codePlan;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const scored: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const offer = (priorPlan?: { lines: NonNullable<ReturnType<typeof priorPlanFor>["lines"]>; sheet: string }) =>
          offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textBlocks: d.textBlocks, textItems, ...(priorPlan === undefined ? {} : { priorPlan }) }).offeredRuns;
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
        if (RENO_MODEL !== null) for (const r of renoModelRemovals({ offered: runsBefore, kept: runs, pairings: scored, pairModel: setConfig.model, segments: strokes.segments, textItems, widthPt: W, feetPerUnit: fpu, ...(runPrior === undefined ? {} : { prior: runPrior }) }, RENO_MODEL)) held.add(r);
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
        let gradedKeyLf = 0;
        // H4/H5 (Diego 2026-11-19): needs-answer walls (height unknowable from
        // the documents) and no-board walls (bare CMU) price NO board on the
        // key side (keyWallFeet returns feet 0), and the SAME share leaves the
        // posted side below — a key the documents cannot price must not charge
        // the product for pricing it either way.
        let needsAnswerLf = 0;
        let noBoardLf = 0;
        // Scoreboard v3 (prereg-scoreboard-v3.md): each key wall's KEY-KNOWN height
        // (null where the key does not know it) and whether it sat at the default.
        const keyKnownFeet: (number | null)[] = [];
        const keyAtDefault: boolean[] = [];
        for (const k of key) {
          const t = (((k as { wallType?: string }).wallType ?? "").trim()).toUpperCase();
          const r = keyWallFeet({ code: t, types: keyTypes, sheet, sideRoomNumbers: keyWallRooms(k), zoneKey, defaultFeet: NOMINAL_FEET });
          const ungraded = r.from === "default" || r.from === "zone-unresolved" || r.from === "needs-answer" || r.from === "no-board";
          keyKnownFeet.push(ungraded ? null : r.feet);
          keyAtDefault.push(r.from === "default" || r.from === "zone-unresolved");
          keyBoardSf += k.lengthFeet * r.feet * 2;
          if (r.from === "sheet-zone") kzSheet += 1;
          if (r.from === "room-zone") kzRoom += 1;
          if (r.from === "zone-unresolved") kzUnresolved += 1;
          if (r.from === "needs-answer") needsAnswerLf += k.lengthFeet;
          if (r.from === "no-board") noBoardLf += k.lengthFeet;
          if (r.from === "default" || r.from === "zone-unresolved") {
            defaultedBoardSf += k.lengthFeet * NOMINAL_FEET * 2;
            if (t !== "" && t !== "0" && t !== "U") unmatchedSpellings[`${dir.slice(0, 18)}:${t}`] = (unmatchedSpellings[`${dir.slice(0, 18)}:${t}`] ?? 0) + k.lengthFeet;
          } else if (r.from !== "needs-answer" && r.from !== "no-board") {
            // Scoreboard v2 (prereg-scoreboard-v2.md): a GRADED key wall — priced
            // from a matched heights-key entry, so a height grade means something.
            gradedKeyLf += k.lengthFeet;
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
        // ── SCOREBOARD V2 (prereg-scoreboard-v2.md) ──
        // Board the zero-touch posting carries on JUNK runs, at each run's own
        // chain height — the share Diego's audit found mislabelled as "height gap".
        let junkBoardSf = 0;
        for (let at = 0; at < runs.length; at += 1) {
          const r = runs[at]!;
          if (!held.has(r) && junk[at]) junkBoardSf += r.lengthFeet * runFeet(r) * 2;
        }
        const junkBoardSfAdj = junkBoardSf * (1 - exclFraction);
        // THE REVIEWED POSTURE: on a sheet the product flags as showing existing
        // work, one WORK_AREA box per cluster of the key's walls (two at most),
        // applied with the PRODUCT's own clipToWorkArea, then the shipped presses.
        // Any other sheet: REVIEWED = zero-touch, unchanged.
        let revLf = zeroLf, revJunkLf = junkLf, revBoardSf = zeroBoardSf, rev10Lf = lf10, rev10BoardSf = lf10BoardSf;
        if (renovation && wallTest && key.length > 0) {
          const xsAll = key.flatMap((k) => [k.x1, k.x2]), ysAll = key.flatMap((k) => [k.y1, k.y2]);
          const spanX = Math.max(...xsAll) - Math.min(...xsAll), spanY = Math.max(...ysAll) - Math.min(...ysAll);
          const mids = key.map((k) => (spanX >= spanY ? (k.x1 + k.x2) / 2 : (k.y1 + k.y2) / 2));
          const order = mids.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
          let cut = -1, best = 0.15; // the prereg's split gap, page-width units
          for (let i = 1; i < order.length; i += 1) {
            const gap = order[i]![0] - order[i - 1]![0];
            if (gap > best) { best = gap; cut = i; }
          }
          const groups = cut < 0 ? [key] : [order.slice(0, cut).map(([, i]) => key[i]!), order.slice(cut).map(([, i]) => key[i]!)];
          const M = 0.02; // the prereg's margin, page-width units
          const boxes: Polygon[] = groups.map((g) => {
            const gx = g.flatMap((k) => [k.x1, k.x2]), gy = g.flatMap((k) => [k.y1, k.y2]);
            const x0 = Math.min(...gx) - M, x1 = Math.max(...gx) + M, y0 = Math.min(...gy) - M, y1 = Math.max(...gy) + M;
            return { xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] };
          });
          const clip = clipToWorkArea(runs as readonly WallCandidate[], boxes, fpu);
          const atOf = new Map(runs.map((r, at) => [r as unknown as WallCandidate, at] as const));
          const pieces = [
            ...clip.inside.map((r) => ({ src: r, feet: (r as unknown as { lengthFeet: number }).lengthFeet })),
            ...clip.split.map((sp) => ({ src: sp.from, feet: sp.piece.lengthFeet })),
          ];
          const srcRun = (p: (typeof pieces)[number]) => runs[atOf.get(p.src) ?? -1]!;
          const isHeld = (p: (typeof pieces)[number]) => held.has(srcRun(p));
          const isJunk = (p: (typeof pieces)[number]) => junk[atOf.get(p.src) ?? -1] === true;
          revLf = pieces.reduce((n, p) => n + (isHeld(p) ? 0 : p.feet), 0);
          revJunkLf = pieces.reduce((n, p) => n + (!isHeld(p) && isJunk(p) ? p.feet : 0), 0);
          revBoardSf = pieces.reduce((n, p) => n + (isHeld(p) ? 0 : p.feet * runFeet(srcRun(p)) * 2), 0);
          const revEntries = pieces.map((p, i) => ({ at: i, held: isHeld(p), score: scores[atOf.get(p.src) ?? -1] ?? null, lengthFeet: p.feet }));
          rev10Lf = revLf; rev10BoardSf = revBoardSf;
          let revAnswered = 0;
          for (const i of reviewOrder(revEntries, "doubt")) {
            if (revAnswered >= PRESSES) break;
            revAnswered += 1;
            const p = pieces[i]!;
            if (!isHeld(p) && isJunk(p)) { rev10Lf -= p.feet; rev10BoardSf -= p.feet * runFeet(srcRun(p)) * 2; }
            if (isHeld(p) && !isJunk(p)) { rev10Lf += p.feet; rev10BoardSf += p.feet * runFeet(srcRun(p)) * 2; }
          }
        }
        const revMissedLf = Math.max(0, keyLf - (revLf - revJunkLf));
        const revBoardSfAdj = revBoardSf * (1 - exclFraction);
        const rev10BoardSfAdj = rev10BoardSf * (1 - exclFraction);
        // ── SCOREBOARD V3 (prereg-scoreboard-v3.md): ACTIONS TO EXACT + REVIEWED-2MIN ──
        // Junk / covered use the eval's own >=50%-uncovered rule through
        // heldOutScore's uncoveredFeet, so v3 cannot disagree with v2 about what a
        // junk run or a missed wall is.
        const asScored = (r: (typeof runs)[number]): ScoredRun => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun);
        const isJunkAt = (at: number) => junk[at] === true;
        const postedRealAt = runs.map((r, at) => !held.has(r) && !isJunkAt(at));
        const heldRealAt = runs.map((r, at) => held.has(r) && !isJunkAt(at));
        const coverSet = runs.filter((_, at) => postedRealAt[at] || heldRealAt[at]).map(asScored);
        const missedKeyAt = key.map((k) => uncoveredFeet(k, coverSet, fpu) >= 0.5 * k.lengthFeet);
        // Each real run's key wall = the one it overlaps most (its type and height).
        const matchOf = runs.map((r, at) => {
          if (isJunkAt(at)) return -1;
          let best = -1, bestCover = 0;
          const one = asScored(r);
          for (let ki = 0; ki < key.length; ki += 1) {
            const cover = r.lengthFeet - uncoveredFeet(one, [key[ki]!], fpu);
            if (cover > bestCover) { bestCover = cover; best = ki; }
          }
          return best;
        });
        const typeOfKey = (ki: number) => ((((key[ki] as { wallType?: string }).wallType ?? "").trim()).toUpperCase());
        // BOX candidates: the product's WORK_AREA on every sheet (amendment 1),
        // key-cluster boxes k = 1..3 applied with the product's own clipToWorkArea.
        const clusterBoxes = (kMax: number): Polygon[] => {
          const xsAll = key.flatMap((k) => [k.x1, k.x2]), ysAll = key.flatMap((k) => [k.y1, k.y2]);
          const spanX = Math.max(...xsAll) - Math.min(...xsAll), spanY = Math.max(...ysAll) - Math.min(...ysAll);
          const order = key.map((k, i) => [spanX >= spanY ? (k.x1 + k.x2) / 2 : (k.y1 + k.y2) / 2, i] as const).sort((x, y) => x[0] - y[0]);
          const gaps = order.slice(1).map((o, i) => [o[0] - order[i]![0], i + 1] as const).filter(([g]) => g > 0.15).sort((x, y) => y[0] - x[0]).slice(0, kMax - 1).map(([, at]) => at).sort((x, y) => x - y);
          const cuts = [0, ...gaps, order.length];
          const MARGIN = 0.02;
          return cuts.slice(1).map((end, gi) => {
            const g = order.slice(cuts[gi]!, end).map(([, i]) => key[i]!);
            const gx = g.flatMap((k) => [k.x1, k.x2]), gy = g.flatMap((k) => [k.y1, k.y2]);
            const x0 = Math.min(...gx) - MARGIN, x1 = Math.max(...gx) + MARGIN, y0 = Math.min(...gy) - MARGIN, y1 = Math.max(...gy) + MARGIN;
            return { xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] };
          });
        };
        const keptFeetFor = (boxes: Polygon[]) => {
          const inside = new Map<number, number>();
          if (boxes.length === 0) { runs.forEach((r, at) => inside.set(at, r.lengthFeet)); return inside; }
          const atOf3 = new Map(runs.map((r, at) => [r as unknown as WallCandidate, at] as const));
          const clip3 = clipToWorkArea(runs as readonly WallCandidate[], boxes, fpu);
          for (const r of clip3.inside) { const at = atOf3.get(r); if (at !== undefined) inside.set(at, (inside.get(at) ?? 0) + (r as unknown as { lengthFeet: number }).lengthFeet); }
          for (const sp of clip3.split) { const at = atOf3.get(sp.from); if (at !== undefined) inside.set(at, (inside.get(at) ?? 0) + sp.piece.lengthFeet); }
          return inside;
        };
        const boxSets = new Map<number, Polygon[]>();
        if (wallTest && key.length > 0) {
          for (let kk = 1; kk <= 3; kk += 1) {
            const boxes = clusterBoxes(kk);
            if (boxes.length < kk) break; // no further split exists
            boxSets.set(boxes.length, boxes);
          }
        }
        const atOfX = new Map(runs.map((r, at) => [r as unknown as WallCandidate, at] as const));
        // ERASE candidates (W2 item 2, erase-area-tool.md P6): the second's estimator from prereg-erase-area.md, its
        // constants unchanged — posted junk midpoints within 10 ft cluster (single link), a box is the cluster's
        // bounding box padded 1 ft, a box is refused when real LF inside exceeds 10% of all LF inside, up to 3 boxes,
        // greedy by junk LF inside. What each box takes is the PRODUCT's own eraseInBoxes (whole runs). On every scored
        // sheet (the product has no renovation gate for it). ZT_ERASE=0 is the A/B's OFF arm.
        const eraseOptions: { boxes: number; erased: ReadonlySet<number> }[] = [];
        if (process.env.ZT_ERASE !== "0" && wallTest && key.length > 0) {
          const posted = (at: number) => !held.has(runs[at]!);
          const junkAts = runs.map((_, at) => at).filter((at) => posted(at) && isJunkAt(at));
          const mid = (at: number) => ({ x: (runs[at]!.x1 + runs[at]!.x2) / 2, y: (runs[at]!.y1 + runs[at]!.y2) / 2 });
          const near = 10 / fpu, pad = 1 / fpu;
          const parent = new Map(junkAts.map((at) => [at, at] as const));
          const root = (at: number): number => (parent.get(at) === at ? at : root(parent.get(at)!));
          for (let a = 0; a < junkAts.length; a += 1) for (let b = a + 1; b < junkAts.length; b += 1) {
            const p = mid(junkAts[a]!), q = mid(junkAts[b]!);
            if (Math.hypot(p.x - q.x, p.y - q.y) <= near) parent.set(root(junkAts[a]!), root(junkAts[b]!));
          }
          const clusters = new Map<number, number[]>();
          for (const at of junkAts) clusters.set(root(at), [...(clusters.get(root(at)) ?? []), at]);
          const boxes = [...clusters.values()].map((members) => {
            const xs = members.flatMap((at) => [runs[at]!.x1, runs[at]!.x2]), ys = members.flatMap((at) => [runs[at]!.y1, runs[at]!.y2]);
            const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
            const erased = eraseInBoxes(runs.map((r, at) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, at })), [{ xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] }]).erased.map((r) => r.at).filter(posted);
            const junkLf = erased.filter(isJunkAt).reduce((n, at) => n + runs[at]!.lengthFeet, 0);
            const allLf = erased.reduce((n, at) => n + runs[at]!.lengthFeet, 0);
            return { erased, junkLf, refused: allLf > 0 && (allLf - junkLf) / allLf > 0.1 };
          }).filter((b) => !b.refused && b.junkLf > 0).sort((a, b) => b.junkLf - a.junkLf).slice(0, 3);
          for (let k = 1; k <= boxes.length; k += 1) eraseOptions.push({ boxes: k, erased: new Set(boxes.slice(0, k).flatMap((b) => b.erased)) });
        }
        const actInput: ActionsInput = {
          runs: runs.map((r, at) => ({ lengthFeet: r.lengthFeet, held: held.has(r), junk: isJunkAt(at), heightFeet: runFeet(r), keyIndex: matchOf[at]! })),
          key: key.map((k, ki) => ({ missed: missedKeyAt[ki]!, type: typeOfKey(ki), knownFeet: keyKnownFeet[ki] ?? null })),
          boxOptions: [...boxSets.entries()].map(([n, boxes]) => ({ boxes: n, insideFeet: keptFeetFor(boxes) })),
          eraseOptions,
          // Amendment 2: the product's own wallsLikeThese decides each click's class,
          // on the product's survivors; one class per standing posted-junk run.
          likeClasses: (standing) => {
            const classes: number[][] = [];
            const classed = new Set<number>();
            for (let at = 0; at < runs.length; at += 1) {
              if (!standing[at] || !isJunkAt(at) || classed.has(at)) continue;
              const r = runs[at]!;
              const like = wallsLikeThese([{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }], runs as readonly WallCandidate[], unitSegments, fpu);
              const members = [...like.excluded].map((w) => atOfX.get(w)).filter((i): i is number => i !== undefined);
              if (members.length === 0) continue;
              members.forEach((i) => classed.add(i));
              classed.add(at);
              classes.push(members);
            }
            return classes;
          },
        };
        const act = actionsToExact(actInput);
        // The REVIEWED-2MIN posture's boxes: the counter's own choice, capped at 3 in all (Amendment 3).
        const posture = postureChoice(actInput);
        const bestK = posture.B;
        const bestBoxes: Polygon[] = boxSets.get(bestK) ?? [];
        const sheetActions = act.actions;
        // THE REVIEWED-2MIN POSTURE: the chosen boxes (work-area AND erase, 3 in all), the 10 shipped answers,
        // then one height answer per key-known type.
        const inside2 = keptFeetFor(bestBoxes);
        const pieces2 = postureFeet(runs.map((r) => r.lengthFeet), inside2, posture.erased).map((feet, at) => ({ at, feet })).filter((p) => p.feet > 0);
        const flipped = new Set<number>();
        {
          const entries2 = pieces2.map((p, i) => ({ at: i, held: held.has(runs[p.at]!), score: scores[p.at] ?? null, lengthFeet: p.feet }));
          let answered2 = 0;
          for (const i of reviewOrder(entries2, "doubt")) {
            if (answered2 >= PRESSES) break;
            answered2 += 1;
            const p = pieces2[i]!;
            const isHeld = held.has(runs[p.at]!);
            if ((!isHeld && isJunkAt(p.at)) || (isHeld && !isJunkAt(p.at))) flipped.add(i);
          }
        }
        let a2Lf = 0, a2JunkLf = 0, a2JunkBoardSf = 0, a2RealGradedSf = 0, a2DefaultPostedSf = 0;
        pieces2.forEach((p, i) => {
          // Posted = not held, unless an answer flipped it (held === flipped). The
          // first gate run had this inverted and priced the HELD walls — caught by
          // build gate 2 (Topeka read $440k under on a 98%-recall sheet).
          const posted = held.has(runs[p.at]!) === flipped.has(i);
          if (!posted) return;
          a2Lf += p.feet;
          if (isJunkAt(p.at)) { a2JunkLf += p.feet; a2JunkBoardSf += p.feet * runFeet(runs[p.at]!) * 2; return; }
          const ki = matchOf[p.at]!;
          const kf = ki >= 0 ? keyKnownFeet[ki] : null;
          if (kf !== null && kf !== undefined) a2RealGradedSf += p.feet * kf * 2; // the height answer
          else if (ki >= 0 && keyAtDefault[ki]) a2DefaultPostedSf += p.feet * runFeet(runs[p.at]!) * 2;
        });
        const a2MissedLf = Math.max(0, keyLf - (a2Lf - a2JunkLf));
        const keyGradedBoardSf = key.reduce((n, k, ki) => n + (keyKnownFeet[ki] != null ? k.lengthFeet * (keyKnownFeet[ki] as number) * 2 : 0), 0);
        const keyDefaultBoardSf = key.reduce((n, k, ki) => n + (keyAtDefault[ki] ? k.lengthFeet * NOMINAL_FEET * 2 : 0), 0);
        if (wallTest) v3Sheets.push({ group: HELD ? "HELD-OUT" : "TRAINING", set: dir, sheet, actions: sheetActions, B: act.B, X: act.X, E: act.E, J: act.J, L: act.L, R: act.R, M: act.M, H: act.H });
        // DISPUTE DUMP (truth-audit-design.md): posted junk (A) + missed key walls (B),
        // >=3 ft, coordinates only. The category is written HERE and nowhere a Chrome
        // batch reads; the audit's blind lists are generated from this file.
        if (process.env.ZT_DISPUTE_DUMP && wallTest) {
          runs.forEach((r, at) => {
            if (held.has(r) || !isJunkAt(at) || r.lengthFeet < 3) return;
            appendFileSync(process.env.ZT_DISPUTE_DUMP!, JSON.stringify({ cat: "A", set: dir, sheet, page: saved.page, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, L: r.lengthFeet }) + "\n");
          });
          key.forEach((k, ki) => {
            if (!missedKeyAt[ki] || k.lengthFeet < 3) return;
            appendFileSync(process.env.ZT_DISPUTE_DUMP!, JSON.stringify({ cat: "B", set: dir, sheet, page: saved.page, x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2, L: k.lengthFeet }) + "\n");
          });
        }
        // JUNKDUMP (the third's audit instrument, adopted committed per the env-audit
        // order): every POSTED junk run — exactly the runs summed into junkLf — with
        // nearby text and geometry, for family analysis. Gated on ZT_JUNKDUMP; no
        // scored path touched.
        if (process.env.ZT_JUNKDUMP) {
          const sums = { junkLf: 0 };
          for (let at = 0; at < runs.length; at += 1) {
            const r = runs[at]!;
            if (held.has(r) || !junk[at]) continue;
            sums.junkLf += r.lengthFeet;
            const mx = (r.x1 + r.x2) / 2, my = (r.y1 + r.y2) / 2;
            const near = textItems.map((t) => ({ s: t.str, x: (t.x + t.width / 2) / W, y: t.y / W })).filter((t) => t.s.trim() !== "" && Math.hypot(t.x - mx, t.y - my) * fpu <= 12).map((t) => ({ ...t, d: +(Math.hypot(t.x - mx, t.y - my) * fpu).toFixed(1) })).sort((a, b) => a.d - b.d).slice(0, 15);
            const curved = d.found.inUnits.filter((g) => (g as { curved?: boolean }).curved === true && Math.hypot((g.x1 + g.x2) / 2 - mx, (g.y1 + g.y2) / 2 - my) * fpu <= r.lengthFeet / 2 + 2).length;
            appendFileSync(process.env.ZT_JUNKDUMP, JSON.stringify({ t: "run", set: dir, sheet, page: saved.page, pdf, wallTest, renovation, excl: exclFraction, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, L: r.lengthFeet, th: r.thicknessFeet, h: runFeet(r), fpu, W, H: strokes.heightPt, curved, near }) + "\n");
          }
          appendFileSync(process.env.ZT_JUNKDUMP, JSON.stringify({ t: "sheet", set: dir, sheet, wallTest, renovation, junkLf, dumped: sums.junkLf }) + "\n");
        }
        const keyByType: Record<string, number> = {};
        for (const k of key) {
          const t = ((k as { wallType?: string }).wallType ?? "0").trim() || "0";
          keyByType[t] = Math.round(((keyByType[t] ?? 0) + k.lengthFeet) * 10) / 10;
        }
        const s = bySet.get(dir) ?? { lf: 0, doors: 0, windows: 0, lf10: 0, keyLf: 0, keyDoors: 0, keyWindows: 0, keyByType: {}, sheets: 0, junkLf: 0, junkRenoLf: 0, missedLf: 0, keyBoardSf: 0, renovation: false, doorsOver: 0, unpricedBoardSf: 0, zeroBoardSf: 0, lf10BoardSf: 0, needsAnswerLf: 0, noBoardLf: 0, revLf: 0, rev10Lf: 0, revJunkLf: 0, revMissedLf: 0, revBoardSf: 0, rev10BoardSf: 0, junkBoardSf: 0, gradedKeyLf: 0, defaultedBoardSf: 0, a2Lf: 0, a2JunkLf: 0, a2MissedLf: 0, a2JunkBoardSf: 0, a2RealGradedSf: 0, a2DefaultPostedSf: 0, keyGradedBoardSf: 0, keyDefaultBoardSf: 0 };
        // Not a wall test: every wall/board term is zeroed, doors/windows stay.
        const w = wallTest ? 1 : 0;
        s.lf += zeroLf * w; s.lf10 += lf10 * w; s.doors += Math.min(postedDoors, keyDoors); s.doorsOver += Math.max(0, postedDoors - keyDoors); s.keyLf += keyLf * w; s.keyDoors += keyDoors; s.keyWindows += keyWindows; s.sheets += 1; s.junkLf += junkLf * w; if (renovation) s.junkRenoLf += junkLf * w; s.missedLf += missedLf * w; s.keyBoardSf += keyBoardSf * w; s.unpricedBoardSf += unpricedBoardSf * w; s.zeroBoardSf += zeroBoardSfAdj * w; s.lf10BoardSf += lf10BoardSfAdj * w; s.needsAnswerLf += needsAnswerLf * w; s.noBoardLf += noBoardLf * w; s.renovation = s.renovation || (renovation && wallTest); s.revLf += revLf * w; s.rev10Lf += rev10Lf * w; s.revJunkLf += revJunkLf * w; s.revMissedLf += revMissedLf * w; s.revBoardSf += revBoardSfAdj * w; s.rev10BoardSf += rev10BoardSfAdj * w; s.junkBoardSf += junkBoardSfAdj * w; s.gradedKeyLf += gradedKeyLf * w; s.defaultedBoardSf += defaultedBoardSf * w; s.a2Lf += a2Lf * w; s.a2JunkLf += a2JunkLf * w; s.a2MissedLf += a2MissedLf * w; s.a2JunkBoardSf += a2JunkBoardSf * w; s.a2RealGradedSf += a2RealGradedSf * w; s.a2DefaultPostedSf += a2DefaultPostedSf * w; s.keyGradedBoardSf += keyGradedBoardSf * w; s.keyDefaultBoardSf += keyDefaultBoardSf * w;
        if (wallTest) for (const [t, ft] of Object.entries(keyByType)) s.keyByType[t] = Math.round(((s.keyByType[t] ?? 0) + ft) * 10) / 10;
        bySet.set(dir, s);
        rows.push({ set: dir, sheet, paired, renovation, keyLf: Math.round(keyLf * w), zeroLf: Math.round(zeroLf * w), lf10: Math.round(lf10 * w), junkLf: Math.round(junkLf * w), missedLf: Math.round(missedLf * w), keyBoardSf: Math.round(keyBoardSf * w), unpricedBoardSf: Math.round(unpricedBoardSf * w), zeroBoardSf: Math.round(zeroBoardSfAdj * w), chainFeet, chainFrom: chain?.from ?? null, rooms: foundRooms.rooms.length, keyDoors, postedDoors, keyWindows });
        if (codePlan) console.log(`ZT ${HELD ? "HELD-OUT" : "TRAINING"} ${dir.slice(0, 26)} ${sheet}: CODE/LIFE-SAFETY PLAN — wall and board terms excluded (codePlanTitle)`);
        else if (enlargedWhy !== null) console.log(`ZT ${HELD ? "HELD-OUT" : "TRAINING"} ${dir.slice(0, 26)} ${sheet}: ENLARGED PLAN — wall and board terms excluded (enlargedPlanReason)`);
        else if (!wallTest) console.log(`ZT ${HELD ? "HELD-OUT" : "TRAINING"} ${dir.slice(0, 26)} ${sheet}: wall review never ran (door/window keys only) — wall and board terms excluded (wallTestFromLabels)`);
      }
    }
    const group = HELD ? "HELD-OUT" : "TRAINING";
    console.log(`ZT RUNMODEL ${group}: ${RUN_MODEL === null ? "OFF (TAKEOFF_WALL_RUN_MODEL unset)" : "ON (remove-only below 0.10)"}`);
    console.log(`ZT RENOMODEL ${group}: ${RENO_MODEL === null ? "OFF (TAKEOFF_WALL_RENO_MODEL unset)" : "ON (paired renovation sheets, remove-only below 0.10)"}`);
    console.log(`ZT ROOMSIDES ${group}: ON — rooms ${rsRooms} · run walls ${rsWalls} · heights moved by room sides ${rsMoved}`);
    console.log(`ZT KEYZONES ${group}: ON — key walls priced sheet-zone ${kzSheet} · room-zone ${kzRoom} · zone-unresolved ${kzUnresolved}`);
    let zb = 0, kb = 0, tb = 0;
    let totalErr = 0;
    const cause = { junkNew: 0, junkReno: 0, missed: 0, board: 0, doors: 0, windows: 0, doorsOver: 0, doorsAtFrames: 0, doorsAtFull: 0, windowsInfo: 0, unpricedBoard: 0 };
    // ── SCOREBOARD V2 accumulators (prereg-scoreboard-v2.md) ──
    let zbR = 0, tbR = 0, totalErrR = 0;
    let prPostedLf = 0, prJunkLf = 0, prKeyLf = 0, prMissedLf = 0, prRevLf = 0, prRevJunkLf = 0, prRevMissedLf = 0;
    const causeV2 = { boardOnJunk: 0, heightGap: 0, defaultBoard: 0 };
    // ── SCOREBOARD V3 accumulators (prereg-scoreboard-v3.md) ──
    let kb3 = 0, err3 = 0, gradedHeightErr = 0, defaultKeyBoard = 0, defaultPostedBoard = 0;
    const setErr3: number[] = [];
    // Amendment 3 (Diego, 2026-11-27): criteria 1 and 2 are judged against the FULL
    // key (the basis of every prior exam and the Finish Plan's "49.8% today");
    // default-vs-default stays off the ERROR only. The graded-key figures print
    // beside them for reference.
    let kbFull3 = 0;
    const setErrFull3: number[] = [];
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
      // ── SCOREBOARD V2: the REVIEWED posture's set figures and the cause split ──
      const rBid = bid({ lf: s.revLf, boardSf: s.revBoardSf, doors: s.doors });
      const r10Bid = bid({ lf: s.rev10Lf, boardSf: s.rev10BoardSf, doors: s.doors });
      const revBoardOverSf = Math.max(0, s.revBoardSf - s.keyBoardSf);
      const revBoardUnderSf = Math.max(0, s.keyBoardSf - s.revBoardSf);
      const revOver = s.revJunkLf * PRICE.wallPerLf + s.doorsOver * PRICE.doorEach[DOOR_SCOPE] + revBoardOverSf * PRICE.boardPerSf;
      const revUnder = s.revMissedLf * PRICE.wallPerLf + revBoardUnderSf * PRICE.boardPerSf + Math.max(0, s.keyDoors - s.doors) * PRICE.doorEach[DOOR_SCOPE] + s.keyWindows * WINDOW_PRICE;
      zbR += rBid; tbR += r10Bid; totalErrR += revOver + revUnder;
      prPostedLf += s.lf; prJunkLf += s.junkLf; prKeyLf += s.keyLf; prMissedLf += s.missedLf;
      prRevLf += s.revLf; prRevJunkLf += s.revJunkLf; prRevMissedLf += s.revMissedLf;
      causeV2.boardOnJunk += s.junkBoardSf * PRICE.boardPerSf;
      const gradedKeyBoardSf = Math.max(0, s.keyBoardSf - s.defaultedBoardSf);
      const gradedFrac = s.keyLf > 0 ? Math.min(1, s.gradedKeyLf / s.keyLf) : 1;
      const postedGradedSf = Math.max(0, s.zeroBoardSf - s.junkBoardSf) * gradedFrac;
      causeV2.heightGap += Math.abs(postedGradedSf - gradedKeyBoardSf) * PRICE.boardPerSf;
      causeV2.defaultBoard += s.defaultedBoardSf * PRICE.boardPerSf;
      const rTotErr = kBid === 0 ? "—" : `${(((revOver + revUnder) / kBid) * 100).toFixed(1)}%`;
      const rPct = (x: number) => (kBid === 0 ? "—" : `${(((x - kBid) / kBid) * 100).toFixed(1)}%`);
      console.log(
        `ZTREV ${group} ${dir.slice(0, 26).padEnd(26)} REVIEWED LF ${Math.round(s.revLf)} (zero ${Math.round(s.lf)}) · TOTAL ERROR ${rTotErr} (over $${Math.round(revOver)} + under $${Math.round(revUnder)}) · net ${rPct(rBid)} · after ${PRESSES} presses ${rPct(r10Bid)}${s.renovation ? "" : " · [not flagged: REVIEWED = zero-touch]"}`,
      );
      // ── SCOREBOARD V3 per set: REVIEWED-2MIN, heights graded only where the key knows them ──
      {
        const kBid3 = bid({ lf: s.keyLf, boardSf: s.keyGradedBoardSf, doors: s.keyDoors, windows: s.keyWindows });
        const postedBoard3 = s.a2JunkBoardSf + s.a2RealGradedSf;
        const over3 = s.a2JunkLf * PRICE.wallPerLf + s.doorsOver * PRICE.doorEach[DOOR_SCOPE] + Math.max(0, postedBoard3 - s.keyGradedBoardSf) * PRICE.boardPerSf;
        const under3 = s.a2MissedLf * PRICE.wallPerLf + Math.max(0, s.keyGradedBoardSf - postedBoard3) * PRICE.boardPerSf + Math.max(0, s.keyDoors - s.doors) * PRICE.doorEach[DOOR_SCOPE] + s.keyWindows * WINDOW_PRICE;
        kb3 += kBid3; err3 += over3 + under3;
        gradedHeightErr += Math.abs(s.a2RealGradedSf - s.keyGradedBoardSf) * PRICE.boardPerSf;
        defaultKeyBoard += s.keyDefaultBoardSf * PRICE.boardPerSf; defaultPostedBoard += s.a2DefaultPostedSf * PRICE.boardPerSf;
        if (kBid3 > 0 && s.keyLf > 0) setErr3.push(((over3 + under3) / kBid3) * 100);
        kbFull3 += kBid;
        if (kBid > 0 && s.keyLf > 0) setErrFull3.push(((over3 + under3) / kBid) * 100);
        console.log(`ZT2MIN ${group} ${dir.slice(0, 26).padEnd(26)} TOTAL ERROR ${kBid3 === 0 ? "—" : (((over3 + under3) / kBid3) * 100).toFixed(1) + "%"} (over $${Math.round(over3)} + under $${Math.round(under3)}) · key $${Math.round(kBid3)} graded-heights (v2 key $${Math.round(kBid)})`);
      }
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
    // ── SCOREBOARD V3 HEADLINE (prereg-scoreboard-v3.md): REVIEWED-2MIN + median actions to exact lead ──
    {
      const med = (xs: number[]) => { if (xs.length === 0) return NaN; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2; };
      const rows = v3Sheets.filter((r) => r.group === group);
      const acts = rows.map((r) => r.actions);
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
      if (kbFull3 > 0) console.log(`ZT2MIN ${group} TOTAL ERROR ${((err3 / kbFull3) * 100).toFixed(1)}% of the FULL key $${Math.round(kbFull3)} · MEDIAN SET ${med(setErrFull3).toFixed(1)}% over ${setErrFull3.length} sets — THE HEADLINE (scoreboard v3, criteria 1+2; amendment 3)`);
      if (kb3 > 0) console.log(`ZT2MIN ${group} reference only: ${((err3 / kb3) * 100).toFixed(1)}% of the graded-heights key $${Math.round(kb3)} · median set ${med(setErr3).toFixed(1)}%`);
      console.log(`ZTACT ${group} ACTIONS TO EXACT: median ${med(acts)} per sheet · mean ${(acts.length ? sum((r) => r.actions) / acts.length : 0).toFixed(1)} · pooled ${sum((r) => r.actions)} over ${rows.length} sheets — boxes ${sum((r) => r.B)} · erase boxes ${sum((r) => r.X)} · exclude-like clicks ${sum((r) => r.E)} · junk removes ${sum((r) => r.J)} · real lost to boxes/clicks ${sum((r) => r.L)} · held-real restores ${sum((r) => r.R)} · missed adds ${sum((r) => r.M)} · height answers ${sum((r) => r.H)} (criterion 3; greedy = an upper bound)`);
      console.log(`ZTHGT ${group} height disagreement on KEY-KNOWN heights $${Math.round(gradedHeightErr)} · default-vs-default (OFF the total, own line): key $${Math.round(defaultKeyBoard)} / posted $${Math.round(defaultPostedBoard)}`);
      for (const r of rows) console.log(`ZTACT ${group} ${r.set.slice(0, 26).padEnd(26)} ${r.sheet} actions ${r.actions} (B ${r.B} X ${r.X} E ${r.E} J ${r.J} L ${r.L} R ${r.R} M ${r.M} H ${r.H})`);
    }
    // ── SCOREBOARD V2 HEADLINE (prereg-scoreboard-v2.md): REVIEWED leads; zero-touch is the second line ──
    if (kb > 0) {
      console.log(`ZTREV ${group} TOTAL bid off ${(((zbR - kb) / kb) * 100).toFixed(1)}% reviewed · ${(((tbR - kb) / kb) * 100).toFixed(1)}% after ${PRESSES} presses/sheet (key $${Math.round(kb)})`);
      console.log(`ZTREV ${group} TOTAL ERROR ${((totalErrR / kb) * 100).toFixed(1)}% of key $${Math.round(kb)} — THE HEADLINE (scoreboard v2); the zero-touch line below is the second line`);
      const prec = (p: number, j: number) => (p > 0 ? (((p - j) / p) * 100).toFixed(1) + "%" : "—");
      const rec = (k: number, m: number) => (k > 0 ? (((k - m) / k) * 100).toFixed(1) + "%" : "—");
      console.log(`ZTPR ${group} zero-touch: precision ${prec(prPostedLf, prJunkLf)} · recall ${rec(prKeyLf, prMissedLf)} (by LF) · reviewed: precision ${prec(prRevLf, prRevJunkLf)} · recall ${rec(prKeyLf, prRevMissedLf)}`);
    }
    // ZT TOTAL ERROR = (|over| + |under|) / key — cancelling must never look like accuracy (Diego).
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
      // Scoreboard v2 (prereg-scoreboard-v2.md): the old single "board height gap"
      // label is RETIRED — Diego's audit showed most of it was board on junk.
      ["board on junk walls (posted junk at chain height)", causeV2.boardOnJunk],
      ["height disagreement (heights-key-graded walls only)", causeV2.heightGap],
      ["board at the 9 ft default (ungraded — not a height grade)", causeV2.defaultBoard],
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
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
  });
});
