import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { runsHeldOffEstimate } from "../estimateHold";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { priorPlanFor, type PriorPlan } from "../priorPlan";
import { longFaces } from "../viewAlign";
import { autoPairs, linedUpDemo } from "../priorPlanLoad";
import { demoPlansFor } from "../pairDemoPlans";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import type { WallCandidate } from "../wallVectors";

/**
 * ── PLAN COMPARISON AS THE APP RUNS IT ──
 *
 * The pairing the app makes — `autoPairs` over the sheet numbers and titles the
 * keyless inventory reads, no drawings — and `priorPlanFor` on the paired page,
 * on every labelled sheet: real and junk set aside, and posted vs key at the
 * shipped hold, off against on. Per building on training; `PCA_HELD=1` is
 * held-out, TOTALS ONLY. Needs TAKEOFF_WALL_MODEL.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.PCA_OUT ?? "";
const HELD = process.env.PCA_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };
type Row = { subs: Record<string, number>; unpairedWhy: string; grey: Record<string, number>; causes: Record<string, number>; set: string; sheet: string; renovation: boolean; paired: string; key: number; posted: number; postedOn: number; real: number; junk: number };

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

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("renovation overcount by cause", () => {
  it("scores it on every labelled sheet", { timeout: 7_200_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    const rows: Row[] = [];
    for (const dir of readdirSync(LABELS).sort()) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
      // One set per process when a big set's inventory would outlast one run.
      if (process.env.PCA_ONLY !== undefined && !dir.includes(process.env.PCA_ONLY)) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      const sheetsAll = await sheetsOf(pdf);
      const auto = autoPairs(sheetsAll);
      const setHasDemo = sheetsAll.some((s) => /DEMO/i.test(`${s.sheetNumber ?? ""} ${s.title ?? ""}`) || /^(?:[A-Z]D|D[A-Z]?)[-.\d]/i.test(s.sheetNumber ?? ""));
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const { key } = keyFromLabels(saved);
        if (key.length === 0) continue;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const words = textItems.map((t) => t.str).join(" ");
        const renovation = /\(E\)/i.test(words) || (words.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
        const scored: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const offer = (priorPlan?: { lines: NonNullable<ReturnType<typeof priorPlanFor>["lines"]>; sheet: string }) =>
          offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems, ...(priorPlan === undefined ? {} : { priorPlan }) }).offeredRuns;
        const off = offer();
        let on = off;
        let paired = "-";
        let pair: { demoPage: number; basis: string } | undefined = auto.get(saved.page);
        let unpairedWhy = "";
        let priorUsed: PriorPlan | null = null;
        let demoFaces: { x1: number; y1: number; x2: number; y2: number }[] = [];
        // ── THE OFFER (#1039), AS IF ACCEPTED: no auto pair, the demolition plan the layout check lines up ──
        if (pair === undefined && process.env.PCA_SUGGEST === "1") {
          const cands = demoPlansFor(sheetsAll, saved.page);
          const demos = [];
          for (const p of cands) demos.push({ page: p, ...(await doc.pageStrokes(p)) });
          const best = linedUpDemo({ segments: strokes.segments, widthPt: W }, demos, fpu);
          if (best !== null) pair = { demoPage: best.demoPage, basis: `suggested (${best.votes} walls)` };
          else unpairedWhy = `PAGE ${JSON.stringify(sheetsAll.find((x) => x.pageNumber === saved.page))} DEMOISH ${JSON.stringify(sheetsAll.filter((x) => /DEMO|EXIST/i.test(`${x.sheetNumber ?? ""} ${x.title ?? ""}`) || /^(?:[A-Z]D|D[A-Z]?)[-.\d]/i.test(x.sheetNumber ?? "")))} ` +  `candidates by title [${cands.join(",")}]; each alone: ${demos.map((d) => `p${d.page}=${linedUpDemo({ segments: strokes.segments, widthPt: W }, [d], 1e-9 + fpu)?.votes ?? "<8/paper"}`).join(" ")}; demo-ish pages ${sheetsAll.filter((x) => /DEMO/i.test(`${x.sheetNumber ?? ""} ${x.title ?? ""}`)).map((x) => `p${x.pageNumber} ${x.sheetNumber} ${x.title}`).join(" | ").slice(0, 300)}`;
        }
        if (pair !== undefined) {
          const ds = await doc.pageStrokes(pair.demoPage);
          const dt = (await doc.pageText(pair.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const prior = priorPlanFor({ demo: { segments: ds.segments, textItems: dt, widthPt: ds.widthPt, heightPt: ds.heightPt }, newPage: { segments: strokes.segments, widthPt: W }, newRuns: off, feetPerUnit: fpu });
          paired = `p${pair.demoPage} by ${pair.basis}${prior.lines === null ? ` — not aligned: ${prior.why}` : `, ${prior.votes} votes`}`;
          if (prior.lines !== null) on = offer({ lines: prior.lines, sheet: `p${pair.demoPage}` });
          priorUsed = prior;
          if (prior.lines !== null && prior.shift !== undefined) {
            const fpDemo = (fpu * ds.widthPt) / W, sh = prior.shift;
            demoFaces = longFaces(ds.segments, ds.widthPt, fpDemo).map((f) => ({ x1: f.x1 + sh.dx, y1: f.y1 + sh.dy, x2: f.x2 + sh.dx, y2: f.y2 + sh.dy }));
          }
        }
        await doc.close();
        const junkOf = (r: WallCandidate) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet >= 0.5 * r.lengthFeet;
        const posted = (runs: WallCandidate[]) => {
          const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
          return runs.reduce((n, r) => n + (held.has(r) ? 0 : r.lengthFeet), 0);
        };
        const kept = new Set(on.map((r) => `${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`));
        const aside = off.filter((r) => !kept.has(`${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`));
        let real = 0, junk = 0;
        for (const r of aside) { if (junkOf(r)) junk += r.lengthFeet; else real += r.lengthFeet; }
        // ── WHAT IS LEFT, BY CAUSE: each posted junk run on the compared sheet ──
        const heldOn = new Set(runsHeldOffEstimate(config.model, on, scored, fpu, false));
        const along = (r: WallCandidate) => {
          const band = Math.max(1, r.thicknessFeet / 2 + 0.5) / fpu, L = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
          const ux = (r.x2 - r.x1) / L, uy = (r.y2 - r.y1) / L;
          return strokes.segments.filter((g) => {
            const mx = (g.x1 + g.x2) / 2 / W, my = (g.y1 + g.y2) / 2 / W;
            const t = (mx - r.x1) * ux + (my - r.y1) * uy, off = Math.abs((mx - r.x1) * uy - (my - r.y1) * ux);
            const gl = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) / W;
            return t >= 0 && t <= L && off <= band && gl > 0 && Math.abs(((g.x2 - g.x1) * ux + (g.y2 - g.y1) * uy) / W / gl) > 0.97;
          });
        };
        const EXIST_WORDS = /\bN\.?\s?I\.?\s?C\b|NOT IN CONTRACT|\bEXIST|\(E\)|TO REMAIN|\bE\.?T\.?R\b/i;
        const near = (r: WallCandidate, feet: number) => textItems.some((t) => EXIST_WORDS.test(t.str) && Math.hypot(t.x / W - (r.x1 + r.x2) / 2, t.y / W - (r.y1 + r.y2) / 2) * fpu <= feet);
        const causes: Record<string, number> = {};
        const subs: Record<string, number> = {};
        const grey: Record<string, number> = {};
        for (const r of on) {
          if (heldOn.has(r)) continue;
          const segs = along(r);
          const greyShare = segs.length === 0 ? 0 : segs.filter((g) => (g.gray ?? 0) >= 0.25).length / segs.length;
          // A grey-pen rule's price on this sheet, at three cut-offs: real feet it would lose, junk feet it would drop.
          for (const cut of [0.5, 0.8, 0.95]) if (greyShare >= cut) grey[`${junkOf(r) ? "junk" : "real"}@${cut}`] = (grey[`${junkOf(r) ? "junk" : "real"}@${cut}`] ?? 0) + r.lengthFeet;
          if (!junkOf(r)) continue;
          if (priorUsed !== null && priorUsed.lines !== null && greyShare < 0.5) {
            const lines = priorUsed.lines, L = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
            const share = (cands: readonly { x1: number; y1: number; x2: number; y2: number }[], reachFt: number, base = r as { x1: number; y1: number; x2: number; y2: number }) => {
              const l = Math.hypot(base.x2 - base.x1, base.y2 - base.y1); if (l === 0) return 0;
              const ux = (base.x2 - base.x1) / l, uy = (base.y2 - base.y1) / l, reach = reachFt / fpu, spans: [number, number][] = [];
              for (const p of cands) { const pl = Math.hypot(p.x2 - p.x1, p.y2 - p.y1); if (pl === 0 || Math.abs(((p.x2 - p.x1) * ux + (p.y2 - p.y1) * uy) / pl) < 0.97) continue;
                const off = (x: number, y: number) => Math.abs((x - base.x1) * uy - (y - base.y1) * ux); if (Math.max(off(p.x1, p.y1), off(p.x2, p.y2)) > reach) continue;
                const a = (p.x1 - base.x1) * ux + (p.y1 - base.y1) * uy, b = (p.x2 - base.x1) * ux + (p.y2 - base.y1) * uy; const lo = Math.max(0, Math.min(a, b)), hi = Math.min(l, Math.max(a, b)); if (hi > lo) spans.push([lo, hi]); }
              spans.sort((p, q) => p[0] - q[0]); let c = 0, e = 0; for (const [lo, hi] of spans) if (hi > e) { c += hi - Math.max(lo, e); e = hi; } return c / l; };
            const face = (sgn: number) => { const nx = -(r.y2 - r.y1) / L, ny = (r.x2 - r.x1) / L, o = (sgn * r.thicknessFeet) / 2 / fpu; return { x1: r.x1 + nx * o, y1: r.y1 + ny * o, x2: r.x2 + nx * o, y2: r.y2 + ny * o }; };
            const at05 = share(lines, 0.5), at15 = share(lines, 1.5);
            const facesBoth = Math.min(share(demoFaces, 0.5, face(1)), share(demoFaces, 0.5, face(-1)));
            const facesOne = Math.max(share(demoFaces, 0.5, face(1)), share(demoFaces, 0.5, face(-1)), share(demoFaces, 0.5));
            const sub = priorUsed.walls === "faces"
              ? (facesOne >= 0.7 ? "faces mode: one face only" : at15 >= 0.7 ? "faces mode: offset" : "not on the demolition plan")
              : at05 >= 0.7 ? "same place, thickness band differs" : at15 >= 0.7 ? "offset 0.5-1.5 ft" : at15 >= 0.3 ? "partial (30-70%)" : facesBoth >= 0.7 ? "demo draws both faces, its finder paired no wall" : facesOne >= 0.7 ? "demo draws one face only" : "not on the demolition plan";
            subs[sub] = (subs[sub] ?? 0) + r.lengthFeet;
          }
          const cause = greyShare >= 0.5 ? "grey pen" : near(r, 15) ? "existing/NIC words within 15 ft" : paired !== "-" ? (paired.includes("not aligned") ? "paired, not aligned" : "paired, compare left it") : setHasDemo ? "unpaired, set has a demolition plan" : "unpaired, no demolition plan in set";
          causes[cause] = (causes[cause] ?? 0) + r.lengthFeet;
        }
        if (process.env.PCA_RUNS !== undefined) for (const r of off) appendFileSync(process.env.PCA_RUNS, JSON.stringify({ set: dir, sheet, renovation, k: `${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`, ft: r.lengthFeet, junk: junkOf(r) }) + "\n");
        rows.push({ subs, unpairedWhy, grey, causes, set: dir, sheet, renovation, paired, key: scoreSheet({ set: dir, sheet, key, proposed: [], feetPerUnit: fpu }).keyFeet, posted: posted(off), postedOn: posted(on), real, junk });
      }
    }
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
    if (process.env.PCA_ROWS !== undefined) for (const r of rows) appendFileSync(process.env.PCA_ROWS, JSON.stringify(r) + "\n");
    const f = (n: number) => n.toFixed(0);
    const pct = (p: number, k: number) => `${p >= k ? "+" : ""}${((100 * (p - k)) / k).toFixed(1)}%`;
    const lines: string[] = [];
    if (!HELD) {
      for (const r of rows.filter((x) => x.paired !== "-")) lines.push(`  PAIRED ${r.set.slice(0, 30).padEnd(30)} ${r.sheet.padEnd(8)} ${r.paired} · real ${f(r.real)} / junk ${f(r.junk)}`);
      lines.push("", "PER BUILDING (real lost / junk removed)");
      for (const set of [...new Set(rows.map((r) => r.set))]) {
        const rs = rows.filter((r) => r.set === set);
        const real = rs.reduce((n, r) => n + r.real, 0), junk = rs.reduce((n, r) => n + r.junk, 0);
        if (real + junk > 0) lines.push(`  ${set.slice(0, 40).padEnd(40)} ${f(real)}/${f(junk)}`);
      }
    }
    for (const group of ["renovation", "new build", "all"] as const) {
      const rs = rows.filter((r) => group === "all" || r.renovation === (group === "renovation"));
      if (rs.length === 0) continue;
      const key = rs.reduce((n, r) => n + r.key, 0), real = rs.reduce((n, r) => n + r.real, 0), junk = rs.reduce((n, r) => n + r.junk, 0);
      lines.push(`${HELD ? "HELD-OUT" : "TRAINING"} ${group}: sheets ${rs.length}, paired ${rs.filter((r) => r.paired !== "-").length}, key ${f(key)} · real lost ${f(real)} / junk removed ${f(junk)} (${real > 0 ? (junk / real).toFixed(1) : "∞"}:1) · posted ${pct(rs.reduce((n, r) => n + r.posted, 0), key)} → ${pct(rs.reduce((n, r) => n + r.postedOn, 0), key)}`);
    }
    for (const group of ["renovation", "new build"] as const) {
      const tot: Record<string, number> = {};
      for (const r of rows.filter((x) => x.renovation === (group === "renovation"))) for (const [k, v] of Object.entries(r.causes)) tot[k] = (tot[k] ?? 0) + v;
      lines.push(`CAUSES ${HELD ? "HELD-OUT" : "TRAINING"} ${group} (posted junk ft after compare): ` + Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f(v)}`).join(" · "));
    }
    writeFileSync(OUT, lines.join("\n") + "\n");
  });
});
