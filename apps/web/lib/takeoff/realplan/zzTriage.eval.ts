import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";

/**
 * ── IS THE TRIAGE WORTH KEEPING AS IT IS? ──
 *
 * The viewer withholds candidates the classifier can name — hatch, a grid
 * line past the building, a symbol — and offers the rest. On A102 that took
 * 168 candidates to 2, which is the case for it: a reviewer should not judge
 * 166 hatch lines.
 *
 * The case against it is that it decides for the reviewer, and the miss
 * analysis found reviewers tracing walls BY HAND that the finder had proposed
 * and the classifier had withheld. Until now the panel reported only counts
 * by reason, which cannot tell those two stories apart.
 *
 * So: of the footage set aside, how much is a wall the reviewer later said
 * was real — traced or accepted — and how much is junk nobody wanted?
 *
 * ── WHAT A NUMBER HERE CAN AND CANNOT MEAN ──
 *
 * "Real" means a set-aside line lies along a wall in the KEY: accepted or
 * traced. That is a strong signal and an incomplete one. A set-aside line
 * that is genuinely a wall and which the reviewer never traced — because they
 * never saw it — counts here as junk, so the real figure is a FLOOR, not an
 * estimate. The queue's `offerAll` job exists to close exactly that gap.
 *
 * Measured with the LABELLING arm of the hatch switch on (the third argument
 * to `offeredCandidates`), because that is the behaviour this file exists to
 * grade. What customers see has the rule off until "demote, don't hide" ships,
 * and that arm is the one the held-out score uses.
 *
 * TRAINING SHEETS ONLY.
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
): boolean {
  const la = len(a);
  const lb = len(b);
  if (la === 0 || lb === 0) return false;
  const dot =
    ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
  return Math.abs(dot) > 0.985;
}

describe.skipIf(DIR === "" || LABELS === "")("what the triage sets aside", () => {
  it("measures real wall feet against junk feet, per sheet", { timeout: 7_200_000 }, async () => {
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

    const read: string[] = [];
    const rows: string[] = [];
    const byKind = new Map<string, { real: number; junk: number; counted: number; n: number }>();
    /** Real-wall hatch lines grouped by what their reason says. */
    const realHatchWhy = new Map<string, { ft: number; n: number }>();
    let realTotal = 0;
    let junkTotal = 0;

    for (const file of files.sort((a, b) => a.dir.localeCompare(b.dir))) {
      if (heldOutReason(file.dir) !== null) continue;
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;

      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const textItems = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));

      const detected = detectForSheet({
        segments: strokes.segments,
        textItems,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
      });
      const offered = offeredCandidates({
        walls: detected.found.walls,
        segments: strokes.segments,
        widthPt: strokes.widthPt,
        feetPerUnit: saved.feetPerUnit,
        planBoxes: detected.planBoxes,
      }, false, true);

      const fpu = saved.feetPerUnit;
      // ── "NEAR A REAL WALL" IS TWO DIFFERENT ANSWERS, NOT ONE ──
      //
      // This counted a set-aside line as REAL when it lay along any confirmed
      // wall, accepted or traced, and reported the total as footage the
      // triage hides. That is wrong for half of it, and the half it is wrong
      // about is the larger one.
      //
      // A line beside an ACCEPTED wall is a line whose footage is ALREADY
      // COUNTED — the second face of a wall the finder paired, or a dashed
      // companion drawn next to it. Withholding it costs nothing, and
      // offering it invites the reviewer to accept the same wall twice. That
      // is the triage working, not failing.
      //
      // A line along a TRACED wall is the opposite and is a real loss: the
      // reviewer drew that wall BY HAND, which means the finder had proposed
      // something there and the triage withheld it. Every one of those is
      // work the triage created.
      const accepted = (saved.verdicts ?? []).filter((v) => v.verdict === "wall");
      const tracedWalls = (saved.verdicts ?? []).filter((v) => v.verdict === "traced");

      let sheetReal = 0;
      let sheetJunk = 0;
      const along = (k: { x1: number; y1: number; x2: number; y2: number }, line: typeof offered.setAsideLines[number]) =>
        parallel(line, k) &&
        Math.max(offLine(k, line.x1, line.y1, fpu), offLine(k, line.x2, line.y2, fpu)) <= 2.5;

      for (const line of offered.setAsideLines) {
        const onTrace = tracedWalls.some((k) => along(k, line));
        const onAccepted = accepted.some((k) => along(k, line));
        // A line along BOTH is already counted by the accepted wall, so the
        // trace beside it is not evidence that this line was needed.
        const onKey = onTrace && !onAccepted;
        const at = byKind.get(line.kind) ?? { real: 0, junk: 0, counted: 0, n: 0 };
        at.n += 1;
        if (onAccepted) at.counted += line.lengthFeet;
        if (onKey) {
          if (line.kind === "in-a-hatch") {
            // Bucket the SHAPE of the sentence, not its numbers, or every
            // line is its own group and the table says nothing.
            const shape = line.why
              .replace(/\d+ parallel/, "N parallel")
              .replace(/nearest \d+in/, "nearest Nin");
            const at = realHatchWhy.get(shape) ?? { ft: 0, n: 0 };
            at.ft += line.lengthFeet;
            at.n += 1;
            realHatchWhy.set(shape, at);
          }
          sheetReal += line.lengthFeet;
          at.real += line.lengthFeet;
        } else {
          sheetJunk += line.lengthFeet;
          at.junk += line.lengthFeet;
        }
        byKind.set(line.kind, at);
      }

      realTotal += sheetReal;
      junkTotal += sheetJunk;
      read.push(`${file.dir}/${file.sheet}`);
      rows.push(
        `  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} ` +
          `set aside ${String(offered.setAsideLines.length).padStart(4)} lines · ` +
          `real ${sheetReal.toFixed(0).padStart(6)} ft · junk ${sheetJunk.toFixed(0).padStart(7)} ft` +
          `${sheetReal > 0 ? `  ← ${((sheetReal / Math.max(sheetReal + sheetJunk, 1)) * 100).toFixed(0)}% real` : ""}`,
      );
    }

    expect(read.length, "no training sheet was read, so every figure would be zero").toBeGreaterThan(0);

    console.log(`\n${read.length} training sheets\n`);
    for (const row of rows) console.log(row);
    console.log(
      `\n  TOTAL real ${realTotal.toFixed(0)} ft · junk ${junkTotal.toFixed(0)} ft · ` +
        `${((realTotal / Math.max(realTotal + junkTotal, 1)) * 100).toFixed(1)}% of set-aside footage is a wall ` +
        `the reviewer later confirmed`,
    );

    // ── WHY THE HATCH CLASS STILL HOLDS EVERY FOOT OF REAL WALL ──
    //
    // The "fill between two faces" fix is a measured NO-OP: it released 3
    // lines and 448 ft of junk and not one foot of wall. So the question is
    // which of its conditions the real cases fail, and the reason string now
    // says. Grouped by that sentence, over the hatch-classed lines that lie
    // along a confirmed wall.
    console.log("\nTHE REAL WALL INSIDE in-a-hatch, BY WHAT THE REASON SAYS");
    const byWhy = [...realHatchWhy.entries()].sort((a, b) => b[1].ft - a[1].ft);
    for (const [why, at] of byWhy) {
      console.log(`  ${at.ft.toFixed(0).padStart(7)} ft · ${String(at.n).padStart(4)} lines · ${why}`);
    }

    console.log("\nBY REASON");
    console.log(
      `  ${"kind".padEnd(22)} ${"HIDDEN ft".padStart(10)} ${"counted ft".padStart(11)} ${"junk ft".padStart(9)} ${"lines".padStart(6)}`,
    );
    for (const [kind, at] of [...byKind.entries()].sort((a, b) => b[1].real - a[1].real)) {
      console.log(
        `  ${kind.padEnd(22)} ${at.real.toFixed(0).padStart(10)} ${at.counted.toFixed(0).padStart(11)} ` +
          `${at.junk.toFixed(0).padStart(9)} ${String(at.n).padStart(6)}`,
      );
    }
    console.log(
      "\n  HIDDEN  = along a TRACED wall and NOT along an accepted one: the reviewer drew by hand\n" +
        "            what the triage withheld, so every foot is work the triage created.\n" +
        "  counted = along an ACCEPTED wall: the footage is in the takeoff already, so withholding\n" +
        "            the line costs nothing and offering it invites counting one wall twice.\n" +
        "  junk    = along neither.",
    );
    console.log(
      "\nthe real figure is a FLOOR: a set-aside wall the reviewer never saw, and so never traced, " +
        "counts as junk here",
    );
  });
});
