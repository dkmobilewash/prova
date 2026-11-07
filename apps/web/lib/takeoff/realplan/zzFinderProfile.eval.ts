import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { groupsForStage } from "../stageGroups";

/** Times and CPU-profiles the Run-takeoff path on one sheet. FP_PDF, FP_PAGE, FP_FPU, FP_OUT (.cpuprofile). Keyless. */
describe.skipIf(!process.env.FP_PDF)("the Run-takeoff path on one sheet, timed", () => {
it("profile", { timeout: 1_800_000 }, async () => {
  const page = Number(process.env.FP_PAGE), fpu = Number(process.env.FP_FPU);
  const t = (label: string, t0: number) => console.log(`FP ${label.padEnd(22)} ${(performance.now() - t0).toFixed(0)} ms`);
  let t0 = performance.now();
  const doc = await openPlanPdf(Buffer.from(readFileSync(process.env.FP_PDF!)));
  t("open pdf", t0); t0 = performance.now();
  const strokes = await doc.pageStrokes(page);
  t(`strokes (${strokes.segments.length})`, t0); t0 = performance.now();
  expect(strokes.segments.length, "the sheet parsed to no strokes").toBeGreaterThan(0);
  const text = await doc.pageText(page);
  const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
  t(`text (${textItems.length})`, t0);
  const session = new Session(); session.connect();
  if (process.env.FP_OUT) { await session.post("Profiler.enable"); await session.post("Profiler.setSamplingInterval", { interval: 500 }); await session.post("Profiler.start"); }
  const stages: [string, number][] = [];
  t0 = performance.now();
  const W = strokes.widthPt;
  const detected = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: [], onStage: (s: string, ms: number) => stages.push([s, ms]) } as Parameters<typeof detectForSheet>[0]);
  t(`detectForSheet (${detected.found.walls.length} runs)`, t0);
  for (const [s, ms] of stages) if (ms > 50) console.log(`FP    stage ${s.padEnd(18)} ${ms.toFixed(0)} ms`);
  t0 = performance.now();
  const offered = offeredCandidates({ walls: detected.found.walls, segments: detected.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: detected.planBoxes, textItems });
  t(`offeredCandidates (${offered.offeredRuns.length})`, t0); t0 = performance.now();
  const found = { ...detected.found, walls: offered.offeredRuns, groups: detected.found.regroup(offered.offeredRuns) };
  t("regroup", t0); t0 = performance.now();
  const g = groupsForStage({ found, segmentsPt: strokes.segments, textItems, widthPt: W, feetPerUnit: fpu, wallTypes: [], legendCodes: null });
  t(`groupsForStage (${g.groups.length})`, t0);
  if (process.env.FP_OUT) { const { profile } = await session.post("Profiler.stop"); writeFileSync(process.env.FP_OUT, JSON.stringify(profile)); }
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
  console.log(`FP HASH runs=${hash(offered.offeredRuns.map((r) => [r.x1, r.y1, r.x2, r.y2, r.thicknessFeet, r.lengthFeet]))} setAside=${hash(offered.setAside)} groups=${hash(g.groups)}`);
  console.log(`FP RESULT runs=${offered.offeredRuns.length} ft=${offered.offeredRuns.reduce((n, r) => n + r.lengthFeet, 0).toFixed(1)} groups=${g.groups.length}`);
  await doc.close();
});
});
