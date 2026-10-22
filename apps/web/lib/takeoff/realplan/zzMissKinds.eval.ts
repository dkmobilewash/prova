import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import type { WallCandidate } from "../wallVectors";

/**
 * ── WHY THE FINDER MISSED EACH WALL A REVIEWER HAD TO TRACE ──
 *
 * Every training sheet now carries traces of the walls the finder did not
 * propose, which is the first time this question has been answerable: a trace
 * is a person saying "there is a wall here and you missed it", with
 * coordinates.
 *
 * The complement of the junk analysis. That one asked what the finder
 * proposes wrongly (extra); this asks what it fails to propose (missing). On
 * the held-out keys missing is 1,844 ft against 6,516 ft extra, so this is
 * the smaller number — but it is the one that costs a subcontractor money,
 * because a wall nobody counted is a wall nobody bid.
 *
 * ── THE STAGE IS ATTRIBUTED FROM THE FINDER'S OWN PASSES ──
 *
 * `onCandidate` is told about EVERY pairing, including the ones the greedy
 * pass discards, so "was a pairing ever made here" is answerable rather than
 * guessable. Then the returned stages — `everywhere`, `inBuilding`,
 * `notLettering`, `notBorder`, `walls` — say where it was lost, by the first
 * stage that no longer holds it.
 *
 * Compared by GEOMETRY, not identity: the stages return copies, which cost a
 * whole wrong answer in the junk analysis when `Set.has` matched nothing and
 * reported 100% of the footage as one kind.
 *
 * ── THE KINDS ARE HEURISTICS AND THE CROPS ARE WHERE THEY ARE CHECKED ──
 *
 * A trace records a wall, not why it was missed. Every kind below is inferred
 * from the strokes near it, the text near it, and which stage lost it.
 * "unattributed" staying large is the honest outcome, not something to
 * squeeze.
 *
 * TRAINING SHEETS ONLY: `heldOutReason` refuses the test buildings, because
 * reading what the finder misses on a held-out sheet and then writing a rule
 * for it is tuning on the test key.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Saved = {
  page: number;
  feetPerUnit: number;
  verdicts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet?: number;
    verdict: string;
  }[];
};

type Stage =
  | "never paired"
  | "lost: outside the building"
  | "lost: lettering"
  | "lost: border"
  | "lost: the last filters"
  | "merged into a neighbour"
  | "proposed after all";

type Kind =
  | "single line drawn"
  | "nothing drawn along it"
  | "faces too far apart"
  | "hatched or filled"
  | "existing to remain"
  | "storefront or curtain wall"
  | "short stub"
  | "dense area"
  | "unattributed";

const len = (a: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(a.x2 - a.x1, a.y2 - a.y1);

function offLine(
  a: { x1: number; y1: number; x2: number; y2: number },
  px: number,
  py: number,
  fpu: number,
): number {
  const L = len(a);
  if (L === 0) return Math.hypot(px - a.x1, py - a.y1) * fpu;
  const num = Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1));
  return (num / L) * fpu;
}

function parallel(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
  tolerance = 0.985,
): boolean {
  const la = len(a);
  const lb = len(b);
  if (la === 0 || lb === 0) return false;
  const dot =
    ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
  return Math.abs(dot) > tolerance;
}

/** Does `other` lie along `trace`, close and parallel, covering most of it? */
function coversTrace(
  trace: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number },
  other: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number },
  fpu: number,
  band = 2.5,
): boolean {
  if (!parallel(trace, other)) return false;
  const off = Math.max(
    offLine(trace, other.x1, other.y1, fpu),
    offLine(trace, other.x2, other.y2, fpu),
  );
  if (off > band) return false;
  const L = len(trace) * fpu;
  const ux = (trace.x2 - trace.x1) / Math.max(len(trace), 1e-9);
  const uy = (trace.y2 - trace.y1) / Math.max(len(trace), 1e-9);
  const t1 = ((other.x1 - trace.x1) * ux + (other.y1 - trace.y1) * uy) * fpu;
  const t2 = ((other.x2 - trace.x1) * ux + (other.y2 - trace.y1) * uy) * fpu;
  const overlap = Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
  return overlap >= Math.min(L, other.lengthFeet) * 0.5;
}

describe.skipIf(DIR === "" || LABELS === "")("why the finder missed the traced walls", () => {
  it("attributes every traced wall to a stage and a kind, in feet", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here)) continue;
      for (const name of readdirSync(here)) {
        if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
      }
    }

    const stageFeet = new Map<Stage, number>();
    const stageRuns = new Map<Stage, number>();
    const kindFeet = new Map<Kind, number>();
    const kindRuns = new Map<Kind, number>();
    const examples: { sheet: string; kind: Kind; stage: Stage; feet: number; x1: number; y1: number; x2: number; y2: number }[] = [];
    const read: string[] = [];
    let tracedFeetTotal = 0;
    let doubleCountedFeet = 0;
    let doubleCountedRuns = 0;
    let tracedOverRejectedFeet = 0;
    let tracedOverRejectedRuns = 0;
    let tracedOverUnjudgedFeet = 0;
    let tracedOverUnjudgedRuns = 0;

    for (const file of files) {
      if (heldOutReason(file.dir) !== null) continue;
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as Saved;
      const traces = (saved.verdicts ?? []).filter((v) => v.verdict === "traced");
      if (traces.length === 0) continue;

      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;

      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const items = text.items.map((i) => ({
        str: i.str,
        x: i.x / strokes.widthPt,
        y: i.y / strokes.widthPt,
      }));

      // Every pairing the finder ever considered, including the ones the
      // greedy pass throws away.
      const everyPairing: WallCandidate[] = [];
      const found = findWallsOnSheet({
        segments: strokes.segments,
        textItems: text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        })),
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
        onCandidate: (_features, wall) => everyPairing.push(wall),
      });

      read.push(`${file.dir}/${file.sheet}`);
      const fpu = saved.feetPerUnit;

      for (const trace of traces) {
        tracedFeetTotal += trace.lengthFeet;

        // ── WHICH STAGE LOST IT ──
        const inStage = (list: readonly WallCandidate[]) =>
          list.some((c) => coversTrace(trace, c, fpu));
        let stage: Stage;
        if (inStage(found.walls)) {
          // The trace duplicates something the finder DID propose. Recorded
          // rather than dropped: a reviewer tracing over a proposed wall is a
          // fact about the review, not about the finder.
          stage = "proposed after all";
        } else if (
          found.walls.some(
            (c) => parallel(trace, c) && offLine(c, (trace.x1 + trace.x2) / 2, (trace.y1 + trace.y2) / 2, fpu) <= 2.5 && c.lengthFeet > trace.lengthFeet * 1.8,
          )
        ) {
          stage = "merged into a neighbour";
        } else if (inStage(found.notBorder)) {
          stage = "lost: the last filters";
        } else if (inStage(found.notLettering)) {
          stage = "lost: border";
        } else if (inStage(found.inBuilding)) {
          stage = "lost: lettering";
        } else if (inStage(found.everywhere) || everyPairing.some((c) => coversTrace(trace, c, fpu))) {
          stage = "lost: outside the building";
        } else {
          stage = "never paired";
        }

        // ── AND WHAT KIND OF WALL IT IS ──
        //
        // Only the strokes and the text can say, and both are read near the
        // trace rather than at it: a wall's own faces sit a thickness away.
        // ── SEGMENTS ARE IN PAGE POINTS, THE TRACE IS NOT ──
        //
        // `sheetStrokes` applies the page matrix and returns POINTS; a trace
        // and a candidate are normalised by the page WIDTH. Comparing them
        // directly made every distance enormous, so 96.8% of the traced
        // footage came back as "nothing drawn along it" — a reviewer tracing
        // thin air, which is not a thing that happens. Third time this exact
        // mismatch has bitten in this work: `pageText` is in points too.
        const normalised = strokes.segments.map((seg) => ({
          x1: seg.x1 / strokes.widthPt,
          y1: seg.y1 / strokes.widthPt,
          x2: seg.x2 / strokes.widthPt,
          y2: seg.y2 / strokes.widthPt,
        }));
        const along = normalised.filter(
          (seg) =>
            parallel(trace, seg, 0.97) &&
            Math.max(
              offLine(trace, seg.x1, seg.y1, fpu),
              offLine(trace, seg.x2, seg.y2, fpu),
            ) <= 2.5,
        );
        const longAlong = along.filter(
          (seg) => Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) * fpu >= Math.min(4, trace.lengthFeet * 0.4),
        );
        const offsets = longAlong.map((seg) => offLine(trace, seg.x1, seg.y1, fpu));
        const spread = offsets.length < 2 ? 0 : Math.max(...offsets) - Math.min(...offsets);
        const nearText = (re: RegExp, ft: number) =>
          items.some(
            (i) =>
              re.test(i.str) &&
              Math.hypot((trace.x1 + trace.x2) / 2 - i.x, (trace.y1 + trace.y2) / 2 - i.y) * fpu <= ft,
          );

        let kind: Kind;
        if (nearText(/STOREFRONT|CURTAIN ?WALL|GLAZ|ALUM.*FRAME/i, 12)) {
          kind = "storefront or curtain wall";
        } else if (nearText(/\(E\)|EXIST|TO REMAIN|E\.T\.R/i, 10)) {
          kind = "existing to remain";
        } else if (trace.lengthFeet < 3) {
          kind = "short stub";
        } else if (longAlong.length === 0) {
          kind = "nothing drawn along it";
        } else if (longAlong.length === 1) {
          kind = "single line drawn";
        } else if (along.length >= 12 && longAlong.length <= 2) {
          // Many short strokes along it and no long faces: hatch or fill.
          kind = "hatched or filled";
        } else if (spread > 2.5) {
          kind = "faces too far apart";
        } else if (along.length >= 20) {
          kind = "dense area";
        } else {
          kind = "unattributed";
        }

        // ── DOES THE KEY COUNT THIS WALL TWICE? ──
        //
        // The key is ACCEPTED plus TRACED. A trace lying on a candidate the
        // reviewer also ACCEPTED counts that wall twice, and the key's total
        // footage is what every score is measured against. This is the part
        // of "proposed after all" with money attached.
        const onAccepted = (saved.verdicts ?? []).some(
          (v) => v.verdict === "wall" && coversTrace(trace, { ...v, lengthFeet: v.lengthFeet }, fpu),
        );
        if (onAccepted) {
          doubleCountedFeet += trace.lengthFeet;
          doubleCountedRuns += 1;
        } else if (stage === "proposed after all") {
          // ── TRACED INSTEAD OF ACCEPTED, AND WHY IT MATTERS WHICH ──
          //
          // The wall was proposed and the reviewer drew their own line over
          // it rather than accepting the proposal. Two very different
          // reasons, needing opposite fixes:
          //
          //   REJECTED underneath — the reviewer looked at the proposal and
          //   said no, then traced the same wall. That is a disagreement
          //   about the run's geometry (wrong length, wrong thickness), and
          //   the proposal is the thing to fix.
          //
          //   UNREVIEWED underneath — nobody judged it. Tracing was simply
          //   easier than finding the row, which is a REVIEW problem: the
          //   candidate was there and went unseen.
          const under = (saved.verdicts ?? []).find(
            (v) =>
              (v.verdict === "not-wall" || v.verdict === "unsure") &&
              coversTrace(trace, { ...v, lengthFeet: v.lengthFeet }, fpu),
          );
          if (under !== undefined) {
            tracedOverRejectedFeet += trace.lengthFeet;
            tracedOverRejectedRuns += 1;
          } else {
            tracedOverUnjudgedFeet += trace.lengthFeet;
            tracedOverUnjudgedRuns += 1;
          }
        }

        stageFeet.set(stage, (stageFeet.get(stage) ?? 0) + trace.lengthFeet);
        stageRuns.set(stage, (stageRuns.get(stage) ?? 0) + 1);
        kindFeet.set(kind, (kindFeet.get(kind) ?? 0) + trace.lengthFeet);
        kindRuns.set(kind, (kindRuns.get(kind) ?? 0) + 1);
        if (trace.lengthFeet >= 2) {
          examples.push({
            sheet: `${file.dir}/${file.sheet}`,
            kind,
            stage,
            feet: trace.lengthFeet,
            x1: trace.x1,
            y1: trace.y1,
            x2: trace.x2,
            y2: trace.y2,
          });
        }
      }
    }

    expect(
      read.length,
      "no training sheet with traces was read, so every number below would be zero",
    ).toBeGreaterThan(0);

    // The band is printed because the whole analysis rests on it, and because
    // four runs at four different bands produced identical numbers — which is
    // either a decisive geometry or an environment variable that never
    // arrived, and those look the same from the outside.
    console.log(
      `\n${read.length} training sheets with traces · ${tracedFeetTotal.toFixed(0)} ft traced as missed ` +
        `· band ${Number(process.env.MISS_BAND ?? "1.5")} ft\n`,
    );
    console.log(
      `DOUBLE-COUNTED IN THE KEY: ${doubleCountedFeet.toFixed(0)} ft over ${doubleCountedRuns} traces ` +
        `lie on a candidate the reviewer ALSO accepted — the key counts those walls twice\n`,
    );
    console.log(
      `  of the proposed-after-all footage: ${tracedOverRejectedFeet.toFixed(0)} ft over ` +
        `${tracedOverRejectedRuns} traces sit on a candidate the reviewer REJECTED (a disagreement ` +
        `about the run), and ${tracedOverUnjudgedFeet.toFixed(0)} ft over ${tracedOverUnjudgedRuns} ` +
        `sit on one NOBODY JUDGED (the row was there and went unseen)\n`,
    );
    console.log("WHERE IT WAS LOST");
    console.log(`  ${"stage".padEnd(28)} ${"feet".padStart(9)} ${"share".padStart(7)} ${"runs".padStart(6)}`);
    for (const [stage, ft] of [...stageFeet.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(
        `  ${stage.padEnd(28)} ${ft.toFixed(0).padStart(9)} ` +
          `${((ft / Math.max(tracedFeetTotal, 1)) * 100).toFixed(1).padStart(6)}% ` +
          `${String(stageRuns.get(stage) ?? 0).padStart(6)}`,
      );
    }

    console.log("\nWHAT KIND OF WALL");
    console.log(`  ${"kind".padEnd(28)} ${"feet".padStart(9)} ${"share".padStart(7)} ${"runs".padStart(6)}`);
    for (const [kind, ft] of [...kindFeet.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(
        `  ${kind.padEnd(28)} ${ft.toFixed(0).padStart(9)} ` +
          `${((ft / Math.max(tracedFeetTotal, 1)) * 100).toFixed(1).padStart(6)}% ` +
          `${String(kindRuns.get(kind) ?? 0).padStart(6)}`,
      );
    }

    // ── CROPPED BY STAGE, NOT BY KIND ──
    //
    // The kind heuristics collapsed: 96.8% as "nothing drawn along it" on the
    // first run (a units bug), then 98.3% as "dense area" once that was
    // fixed, because a 2.5 ft band along a real wall catches dozens of
    // strokes and every branch after that is unreachable. A crop list is only
    // worth rendering if its groups mean something, and the STAGE groups come
    // from the finder's own passes rather than from my guesses.
    console.log("\nCROPS");
    for (const [stageName] of [...stageFeet.entries()].sort((a, b) => b[1] - a[1])) {
      for (const e of examples.filter((x) => x.stage === stageName).sort((a, b) => b.feet - a.feet).slice(0, 3)) {
        console.log(
          `  ${stageName}\t${e.sheet}\t${e.feet.toFixed(1)}\t` +
            `${e.x1.toFixed(4)}\t${e.y1.toFixed(4)}\t${e.x2.toFixed(4)}\t${e.y2.toFixed(4)}\t${e.stage}`,
        );
      }
    }
  });
});
