import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { runsHeldOffEstimate } from "../estimateHold";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { priorPlanFor } from "../priorPlan";
import { autoPairs } from "../priorPlanLoad";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import { reviewOrder, runScores } from "../wallReview";
import type { WallCandidate } from "../wallVectors";

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
 *   printed mark (the auto-post door source); no windows (nothing clears
 *   their bar yet).
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
const PRICE = { wallPerLf: 18, boardPerSf: 2.2, doorEach: 350, windowEach: 150 } as const;

/**
 * Heights for the board-SF term: heights-key sets → labelSet → type → feet.
 * A key run whose type the heights key covers carries LF × feet × 2 sides of
 * board; a zero-touch run carries board only when the app assigned a height
 * with no presses (today: none), so the whole board term reads as the
 * "no height" cause until D lands.
 */
const HEIGHTS = process.env.ZT_HEIGHTS ?? "";
const heightsByLabelSet: Record<string, Record<string, number>> = {};
if (HEIGHTS !== "" && existsSync(HEIGHTS)) {
  const hk = JSON.parse(readFileSync(HEIGHTS, "utf8")) as { sets?: Record<string, { labelSet?: string; types?: Record<string, { feet?: number }> }> };
  for (const one of Object.values(hk.sets ?? {})) {
    if (one.labelSet === undefined) continue;
    const m: Record<string, number> = {};
    for (const [t, v] of Object.entries(one.types ?? {})) if (typeof v.feet === "number") m[t.toUpperCase()] = v.feet;
    heightsByLabelSet[one.labelSet] = m;
  }
}

const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

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

const bid = (q: { lf: number; boardSf?: number; doors: number; windows: number }) => q.lf * PRICE.wallPerLf + (q.boardSf ?? 0) * PRICE.boardPerSf + q.doors * PRICE.doorEach + q.windows * PRICE.windowEach;

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("zero-touch bid accuracy", () => {
  it("prices the untouched takeoff against the key", { timeout: 14_400_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    const rows: Record<string, unknown>[] = [];
    const bySet = new Map<string, { lf: number; doors: number; windows: number; lf10: number; keyLf: number; keyDoors: number; keyWindows: number; keyByType: Record<string, number>; sheets: number; junkLf: number; junkRenoLf: number; missedLf: number; keyBoardSf: number; renovation: boolean }>();
    for (const dir of readdirSync(LABELS).sort()) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
      if (process.env.ZT_ONLY !== undefined && !dir.includes(process.env.ZT_ONLY)) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      const sheetsAll = await sheetsOf(pdf);
      const auto = autoPairs(sheetsAll);
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const got = keyFromLabels(saved);
        const key = got.key;
        const keyDoors = got.openings.filter((o) => o.kind === "door").length;
        const keyWindows = got.openings.filter((o) => o.kind === "window").length;
        if (key.length === 0 && keyDoors === 0 && keyWindows === 0) continue;
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
        let runs = offer();
        let paired = "-";
        const pair = auto.get(saved.page);
        if (pair !== undefined) {
          const ds = await doc.pageStrokes(pair.demoPage);
          const dt = (await doc.pageText(pair.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const prior = priorPlanFor({ demo: { segments: ds.segments, textItems: dt, widthPt: ds.widthPt, heightPt: ds.heightPt }, newPage: { segments: strokes.segments, widthPt: W }, newRuns: runs, feetPerUnit: fpu });
          paired = `p${pair.demoPage}`;
          if (prior.lines !== null) runs = offer({ lines: prior.lines, sheet: `p${pair.demoPage}` });
        }
        // Doors with a printed mark: the auto-post class. Schedule rows are a
        // DB read this eval does not make; the mark comes off the drawing.
        const dw = doorsAndWindowsForSheet({ segments: d.found.inUnits, segmentsPt: strokes.segments, textPt: textItems, widthPt: W, walls: d.found.walls, feetPerUnit: fpu, scheduleRows: [] });
        const postedDoors = dw.doorMarks.filter((m) => m !== null && m.trim() !== "").length;
        const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
        const zeroLf = runs.reduce((n, r) => n + (held.has(r) ? 0 : r.lengthFeet), 0);
        // N presses, answered from the key, in the shipped order.
        const junk = runs.map((r) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet >= 0.5 * r.lengthFeet);
        const scores = runScores(config.model, runs, scored, fpu);
        const entries = runs.map((r, at) => ({ at, held: held.has(r), score: scores[at] ?? null, lengthFeet: r.lengthFeet }));
        let lf10 = zeroLf;
        let answered = 0;
        for (const at of reviewOrder(entries, "doubt")) {
          if (answered >= PRESSES) break;
          answered += 1;
          const r = runs[at]!;
          if (!held.has(r) && junk[at]) lf10 -= r.lengthFeet;
          if (held.has(r) && !junk[at]) lf10 += r.lengthFeet;
        }
        await doc.close();
        const keyLf = key.reduce((n, k) => n + k.lengthFeet, 0);
        const words = textItems.map((t) => t.str).join(" ");
        const renovation = /\(E\)/i.test(words) || (words.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
        let junkLf = 0;
        for (let at = 0; at < runs.length; at += 1) if (!held.has(runs[at]!) && junk[at]) junkLf += runs[at]!.lengthFeet;
        const missedLf = Math.max(0, keyLf - (zeroLf - junkLf));
        const hs = heightsByLabelSet[dir] ?? {};
        const keyBoardSf = key.reduce((n, k) => {
          const t = (((k as { wallType?: string }).wallType ?? "").trim()).toUpperCase();
          const ft = hs[t];
          return n + (ft === undefined ? 0 : k.lengthFeet * ft * 2);
        }, 0);
        const keyByType: Record<string, number> = {};
        for (const k of key) {
          const t = ((k as { wallType?: string }).wallType ?? "0").trim() || "0";
          keyByType[t] = Math.round(((keyByType[t] ?? 0) + k.lengthFeet) * 10) / 10;
        }
        const s = bySet.get(dir) ?? { lf: 0, doors: 0, windows: 0, lf10: 0, keyLf: 0, keyDoors: 0, keyWindows: 0, keyByType: {}, sheets: 0, junkLf: 0, junkRenoLf: 0, missedLf: 0, keyBoardSf: 0, renovation: false };
        s.lf += zeroLf; s.lf10 += lf10; s.doors += postedDoors; s.keyLf += keyLf; s.keyDoors += keyDoors; s.keyWindows += keyWindows; s.sheets += 1; s.junkLf += junkLf; if (renovation) s.junkRenoLf += junkLf; s.missedLf += missedLf; s.keyBoardSf += keyBoardSf; s.renovation = s.renovation || renovation;
        for (const [t, ft] of Object.entries(keyByType)) s.keyByType[t] = Math.round(((s.keyByType[t] ?? 0) + ft) * 10) / 10;
        bySet.set(dir, s);
        rows.push({ set: dir, sheet, paired, renovation, keyLf: Math.round(keyLf), zeroLf: Math.round(zeroLf), lf10: Math.round(lf10), junkLf: Math.round(junkLf), missedLf: Math.round(missedLf), keyBoardSf: Math.round(keyBoardSf), keyDoors, postedDoors, keyWindows });
      }
    }
    const group = HELD ? "HELD-OUT" : "TRAINING";
    let zb = 0, kb = 0, tb = 0;
    const cause = { junkNew: 0, junkReno: 0, missed: 0, board: 0, doors: 0, windows: 0 };
    for (const [dir, s] of [...bySet.entries()].sort()) {
      const kBid = bid({ lf: s.keyLf, boardSf: s.keyBoardSf, doors: s.keyDoors, windows: s.keyWindows });
      cause.junkNew += (s.junkLf - s.junkRenoLf) * PRICE.wallPerLf;
      cause.junkReno += s.junkRenoLf * PRICE.wallPerLf;
      cause.missed += s.missedLf * PRICE.wallPerLf;
      cause.board += s.keyBoardSf * PRICE.boardPerSf;
      cause.doors += (s.keyDoors - s.doors) * PRICE.doorEach;
      cause.windows += s.keyWindows * PRICE.windowEach;
      const zBid = bid({ lf: s.lf, doors: s.doors, windows: s.windows });
      const tBid = bid({ lf: s.lf10, doors: s.doors, windows: s.windows });
      zb += zBid; kb += kBid; tb += tBid;
      const pct = (x: number) => (kBid === 0 ? "—" : `${(((x - kBid) / kBid) * 100).toFixed(1)}%`);
      console.log(
        `ZT ${group} ${dir.slice(0, 26).padEnd(26)} sheets ${s.sheets} · key LF ${Math.round(s.keyLf)} doors ${s.keyDoors} windows ${s.keyWindows} · ` +
          `zero LF ${Math.round(s.lf)} doors ${s.doors} windows 0 · bid off ${pct(zBid)} · after ${PRESSES} presses/sheet ${pct(tBid)} · key types ${JSON.stringify(s.keyByType)}`,
      );
    }
    if (kb > 0) console.log(`ZT ${group} TOTAL bid off ${(((zb - kb) / kb) * 100).toFixed(1)}% zero-touch · ${(((tb - kb) / kb) * 100).toFixed(1)}% after ${PRESSES} presses/sheet (key $${Math.round(kb)})`);
    // OVER and UNDER separately, so junk cuts and recovered quantities cannot hide each other (Diego).
    const over = cause.junkNew + cause.junkReno;
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
      ["board (no height assigned)", cause.board],
      ["doors not posted", cause.doors],
      ["windows not posted", cause.windows],
    ];
    const err = Math.abs(zb - kb);
    const sum = named.reduce((n, [, v]) => n + Math.abs(v), 0);
    named.push(["other (residual vs |total error|)", Math.max(0, err - sum)]);
    for (const [label, v] of [...named].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
      console.log(`ZTCAUSE ${group} $${Math.round(Math.abs(v))} · ${label}`);
    }
    writeFileSync(OUT, JSON.stringify({ group, prices: PRICE, cause, rows }, null, 1));
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
  });
});
