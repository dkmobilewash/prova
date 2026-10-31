import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { textRows } from "../existingWalls";
import { suggestedWorkArea } from "../suggestedWorkArea";
import { demoRuns } from "../demoWalls";
import { existingWallSet } from "../existingWallSet";
import { FEW_WALLS_SHARE, MIN_VOTES, onPriorPlan, type PriorLine } from "../planCompare";
import { longFaces, pairsForSet } from "./planPairs";
import { alignViews } from "../viewAlign";
import { keyFromLabels, scoreSheet, type SheetScore } from "../heldOutScore";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import type { Line, Polygon } from "../userExclusions";
import { wallsLikeThese } from "../userExclusions";
import { oneFacePerLine, type StrokeSegment, type WallCandidate } from "../wallVectors";

/**
 * ── THE SCORECARD WITH A REALISTIC USER ON IT ──
 *
 * One work-area box, then up to three kept "exclude walls like this" clicks,
 * per sheet, through the real `user` input of `offeredCandidates`, scored by
 * `scoreSheet`, so the figures sit beside `zzKeyScore`'s.
 *
 * THE USER IS AN ORACLE AND THIS SAYS HOW MUCH. The box is the key's bounds
 * plus a pad: 2 ft is a perfect drawer, 10 ft a sloppy one, and the gap between
 * the two arms is the sensitivity. A click lands on the longest junk-labelled
 * run; it is kept only if it adds more junk than real, which assumes the person
 * sees every bad click. At most six tries.
 *
 * RENOVATION is fixed from each sheet's own words before any score is read:
 * `(E)`, RENOVATION/REMODEL/TENANT IMPROVEMENT, DEMO, or EXISTING three times.
 * NIC alone does not count: it marks items. STRICT asks for `(E)` or EXISTING
 * five times, and is printed so the split's own effect can be seen.
 * Vector sheets with a PDF only; scans are not in this eval. Held-out as totals.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ONLY = (process.env.RU_ONLY ?? "").toLowerCase();
const KEPT_CLICKS = 3;
const TRIES = 6;
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
type Verdict = { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet?: number; verdict: string };
type Saved = { page: number; feetPerUnit: number; verdicts: Verdict[] };
const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;
const ARMS = ["as offered", "box 2 ft", "box 2 ft + clicks", "box 10 ft + clicks", "compare", "compare + box", "compare + box + clicks", "suggested", "suggested + clicks"] as const;
type Arm = (typeof ARMS)[number];
type Row = { suggestion: string | null; priorPage: number | null; priorHow: string; name: string; held: boolean; renovation: boolean; strict: boolean; arms: Record<Arm, SheetScore>; clicks: number; tries: number };

describe.skipIf(DIR === "" || LABELS === "")("the scorecard with a realistic user", () => {
  it("scores a box and three clicks per sheet, new-build against renovation", { timeout: 7_200_000 }, async () => {
    const rows: Row[] = [];
    const pairsBySet = new Map<string, Awaited<ReturnType<typeof pairsForSet>>>();
    let skippedScans = 0;
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      const held = heldOutReason(dir) !== null;
      for (const name of readdirSync(join(LABELS, dir))) {
        if (!name.endsWith(".json")) continue;
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const pdf = findPdf(dir);
        if (pdf === null) continue;
        if (ONLY !== "" && !`${dir}/${sheet}`.toLowerCase().includes(ONLY)) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        // A page with no text layer and next to no lines is a scan: its lines live in the raster stage and
        // this eval does not read them, so scoring it would count the whole key as missed.
        if (text.items.length === 0 || strokes.segments.length < 100) {
          skippedScans += 1;
          continue;
        }
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const words = textRows(textItems).map((r) => r.str).join("\n");
        const e = count(/\(E\)/gi, words), ex = count(/\bEXIST/gi, words);
        const renovation = e > 0 || ex >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
        const strict = e > 0 || ex >= 5;
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
        const units = d.found.inUnits;
        const pts = units.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W }));
        const offer = (user?: { excludeLike?: Line[]; workArea?: Polygon[] }, priorPlan?: PriorLine[]) => offeredCandidates({ walls: d.found.walls, segments: pts, pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems, ...(user === undefined ? {} : { user }), ...(priorPlan === undefined ? {} : { priorPlan }) });
        // ── THE PRIOR PLAN: THE CANDIDATE PAGE THAT COVERS MOST OF THIS SHEET ──
        let priorPlan: PriorLine[] | undefined;
        let priorPage: number | null = null;
        let priorHow = "";
        const liveRuns = offer().offeredRuns;
        const liveFeet = liveRuns.reduce((n, w) => n + w.lengthFeet, 0);
        const doc2 = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        let bestFeet = 0;
        const demoRemoved: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number }[] = [];
        const myFaces = longFaces(strokes.segments, W, fpu);
        const setPairs = pairsBySet.get(dir) ?? (await pairsForSet(doc2, fpu));
        pairsBySet.set(dir, setPairs);
        // The third session's one pairer decides which demolition plan belongs to this sheet.
        for (const pair of setPairs.filter((p) => p.newPage === saved.page && p.primary)) {
          const page = pair.demoPage;
          const t = await doc2.pageText(page);
          const its = t.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const number = pair.basis;
          const st = await doc2.pageStrokes(page);
          if (st.segments.length < 100) continue;
          try {
            const fpOther = (fpu * st.widthPt) / W;
            const faces = longFaces(st.segments, st.widthPt, fpOther);
            const paired = findWallsOnSheet({ segments: st.segments, textItems: its, pageSize: { widthPt: st.widthPt, heightPt: st.heightPt }, feetPerUnit: fpOther, wallTypes: [], sampledSheets: null }).walls;
            const remove = demoRuns(st.segments, st.widthPt, fpOther, its);
            // A wall to be demolished does not remain, so it is not "on the prior plan".
            const onRemoved = (l: Line) => remove.some((r) => onPriorPlan({ ...r, thicknessFeet: 0.5 }, [{ ...l, thicknessFeet: 0.5 }], fpu) || onPriorPlan({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, thicknessFeet: r.thicknessIn / 12 }, [{ ...r, thicknessFeet: r.thicknessIn / 12 }], fpu));
            const remain = paired.filter((w) => !onRemoved(w));
            const few = remain.reduce((n, w) => n + w.lengthFeet, 0) < FEW_WALLS_SHARE * liveFeet;
            const set = existingWallSet({ level: null, remove, remain, newPlan: liveRuns, feetPerUnit: fpu });
            const shift = !few && set.shift !== null ? set.shift : alignViews(myFaces, faces, fpu);
            if (shift === null || shift.votes < MIN_VOTES) continue;
            for (const r of remove) demoRemoved.push({ x1: r.x1 + shift.dx, y1: r.y1 + shift.dy, x2: r.x2 + shift.dx, y2: r.y2 + shift.dy, lengthFeet: r.lengthFeet });
            const lines: PriorLine[] = few ? faces.filter((f) => !onRemoved(f)) : remain.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet }));
            const aligned = lines.map((p) => ({ ...p, x1: p.x1 + shift.dx, y1: p.y1 + shift.dy, x2: p.x2 + shift.dx, y2: p.y2 + shift.dy }));
            const feet = liveRuns.filter((w) => onPriorPlan(w, aligned, fpu)).reduce((n, w) => n + w.lengthFeet, 0);
            if (process.env.RU_DEBUG === "1") console.log(`    PRIOR ${sheet} p${page} ${number ?? "-"}: ${few ? "faces" : "walls"} ${shift.votes} votes, ${feet.toFixed(0)} of ${liveFeet.toFixed(0)} ft`);
            if (feet > bestFeet) {
              bestFeet = feet;
              priorPlan = aligned;
              priorPage = page;
              priorHow = `${few ? "faces" : "walls"}, ${shift.votes} votes, paired by ${pair.basis}`;
            }
          } catch { /* a page too dense to detect is not a prior plan */ }
        }
        await doc2.close();
        const { key } = keyFromLabels(saved, fpu);
        const judged = saved.verdicts.filter((v) => v.verdict === "not-wall");
        const score = (o: ReturnType<typeof offer>) =>
          scoreSheet({ set: dir, sheet, key, judged, feetPerUnit: fpu, proposed: o.candidates.map((c) => ({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, lengthFeet: c.lengthFeet, thicknessFeet: c.thicknessIn === null ? undefined : c.thicknessIn / 12 })) });
        const box = (padFeet: number): Polygon[] => {
          if (key.length === 0) return [];
          const pad = padFeet / fpu;
          const xs = key.flatMap((r) => [r.x1, r.x2]), ys = key.flatMap((r) => [r.y1, r.y2]);
          const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
          return [{ xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] }];
        };
        // A run's verdict, from scoring it alone: junk if it is mostly confirmed junk, real if mostly on the key.
        const verdictOf = new Map<WallCandidate, "real" | "junk" | "other">();
        const verdict = (w: WallCandidate) => {
          const known = verdictOf.get(w);
          if (known !== undefined) return known;
          const s = scoreSheet({ set: dir, sheet, key, judged, feetPerUnit: fpu, proposed: [{ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessFeet }] });
          const v = s.confirmedJunkFeet >= 0.5 * w.lengthFeet ? "junk" : s.extraFeet < 0.5 * w.lengthFeet ? "real" : "other";
          verdictOf.set(w, v);
          return v;
        };
        const clicked = (workArea: Polygon[], prior?: PriorLine[]) => {
          const runs = offer({ workArea }, prior).offeredRuns;
          const feet = (list: Iterable<WallCandidate>, v: string) => [...list].filter((w) => verdict(w) === v).reduce((n, w) => n + w.lengthFeet, 0);
          const kept: Line[] = [];
          const tried = new Set<WallCandidate>();
          let gone = new Set<WallCandidate>();
          while (kept.length < KEPT_CLICKS && tried.size < TRIES) {
            const next = runs.filter((w) => verdict(w) === "junk" && !gone.has(w) && !tried.has(w)).sort((a, b) => b.lengthFeet - a.lengthFeet)[0];
            if (next === undefined) break;
            tried.add(next);
            const line = { x1: next.x1, y1: next.y1, x2: next.x2, y2: next.y2 };
            const trial = wallsLikeThese([...kept, line], runs, units, fpu).excluded;
            const added = [...trial].filter((w) => !gone.has(w));
            if (feet(added, "junk") > feet(added, "real")) {
              kept.push(line);
              gone = trial;
            }
          }
          // The scored arm replays these through the real path, where the style bands see the whole sheet.
          return { kept, tries: tried.size };
        };
        const tight = clicked(box(2)), loose = clicked(box(10)), both = clicked(box(2), priorPlan);
        const suggestion = suggestedWorkArea({ runs: liveRuns, segments: strokes.segments, textItems, widthPt: W, feetPerUnit: fpu, demoRemoved });
        const hinted = suggestion?.polygons ?? [];
        const hintedClicks = clicked(hinted);
        rows.push({
          suggestion: suggestion === null ? null : suggestion.sources.join(" + "), priorPage, priorHow, name: `${dir.slice(0, 22)}/${sheet}`, held, renovation, strict, clicks: tight.kept.length, tries: tight.tries,
          arms: {
            "as offered": score(offer()),
            "box 2 ft": score(offer({ workArea: box(2) })),
            "box 2 ft + clicks": score(offer({ workArea: box(2), excludeLike: tight.kept })),
            "box 10 ft + clicks": score(offer({ workArea: box(10), excludeLike: loose.kept })),
            compare: score(offer(undefined, priorPlan)),
            "compare + box": score(offer({ workArea: box(2) }, priorPlan)),
            "compare + box + clicks": score(offer({ workArea: box(2), excludeLike: both.kept }, priorPlan)),
            suggested: score(offer({ workArea: hinted })),
            "suggested + clicks": score(offer({ workArea: hinted, excludeLike: hintedClicks.kept })),
          },
        });
      }
    }
    const show = (title: string, list: Row[]) => {
      console.log(`\n  ${title}: ${list.length} sheets, ${list.reduce((n, r) => n + r.clicks, 0)} kept clicks, ${list.reduce((n, r) => n + r.tries, 0)} tried`);
      for (const arm of ARMS) {
        const s = list.map((r) => r.arms[arm]);
        const sum = (f: (x: SheetScore) => number) => s.reduce((n, x) => n + f(x), 0);
        const key = sum((x) => x.keyFeet), missing = sum((x) => x.missingFeet), junk = sum((x) => x.confirmedJunkFeet), un = sum((x) => x.unjudgedFeet), prop = sum((x) => x.proposedFeet);
        console.log(`    ${arm.padEnd(20)} key ${key.toFixed(0).padStart(6)} · recall ${(100 * (1 - missing / Math.max(1, key))).toFixed(1).padStart(5)}% · junk ${junk.toFixed(0).padStart(6)} · ${(100 * junk / Math.max(1, key)).toFixed(0).padStart(3)} per 100 key · ${(100 * junk / Math.max(1, prop)).toFixed(0).padStart(3)} per 100 offered · unjudged ${un.toFixed(0)}`);
      }
    };
    for (const [label, held] of [["TRAINING", false], ["HELD-OUT, totals", true]] as const) {
      const set = rows.filter((r) => r.held === held);
      show(`${label} — ALL`, set);
      show(`${label} — NEW-BUILD`, set.filter((r) => !r.renovation));
      show(`${label} — RENOVATION`, set.filter((r) => r.renovation));
      show(`${label} — RENOVATION, strict words`, set.filter((r) => r.strict));
    }
    console.log(`\n  compare, per training sheet where a prior plan aligned: junk removed / real lost`);
    for (const r of rows.filter((x) => !x.held && x.priorPage !== null)) {
      const a = r.arms["as offered"], b = r.arms.compare;
      console.log(`    ${r.name.padEnd(30)} prior p${r.priorPage} ${r.priorHow} · junk ${(a.confirmedJunkFeet - b.confirmedJunkFeet).toFixed(0).padStart(5)} · real ${(b.missingFeet - a.missingFeet).toFixed(0).padStart(5)} · key ${a.keyFeet.toFixed(0)}`);
    }
    const ho = rows.filter((x) => x.held && x.priorPage !== null);
    console.log(`    HELD-OUT, ${ho.length} sheets aligned of ${rows.filter((x) => x.held).length}: junk ${ho.reduce((n, r) => n + r.arms["as offered"].confirmedJunkFeet - r.arms.compare.confirmedJunkFeet, 0).toFixed(0)} · real ${ho.reduce((n, r) => n + r.arms.compare.missingFeet - r.arms["as offered"].missingFeet, 0).toFixed(0)}`);
    console.log(`\n  suggested work area, per training sheet where it fired: junk removed / real lost`);
    for (const r of rows.filter((x) => !x.held && x.suggestion !== null)) {
      const a = r.arms["as offered"], b = r.arms.suggested;
      console.log(`    ${r.name.padEnd(30)} ${(r.suggestion ?? "").padEnd(42)} · junk ${(a.confirmedJunkFeet - b.confirmedJunkFeet).toFixed(0).padStart(5)} · real ${(b.missingFeet - a.missingFeet).toFixed(0).padStart(5)}`);
    }
    const hs = rows.filter((x) => x.held && x.suggestion !== null);
    console.log(`    HELD-OUT, fired on ${hs.length} of ${rows.filter((x) => x.held).length} sheets`);
    console.log(`\n  scans skipped: ${skippedScans}`);
    console.log(`  training renovation sheets: ${rows.filter((r) => !r.held && r.renovation).map((r) => r.name).join(", ")}`);
    console.log(`  training new-build sheets: ${rows.filter((r) => !r.held && !r.renovation).map((r) => r.name).join(", ")}`);
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
  });
});
