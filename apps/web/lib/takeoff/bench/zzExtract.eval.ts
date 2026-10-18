/**
 * TRAINING DATA FROM THE BENCH: every candidate pairing, with a label.
 *
 * The bench is the one source that can label EVERY candidate rather than only
 * the ones a person got round to reviewing — it drew the sheet, so it knows
 * which pairs are walls and which are grid lines, hatch, treads and table
 * rules. That is its whole value here, and also its limit: one generator
 * cannot surprise itself, so this trains and real sheets decide.
 *
 * Writes JSON Lines to `EXTRACT_OUT`, one row per candidate:
 *   { case, family, features: number[], label: 0 | 1 }
 *
 * Nothing from Cedar Hollow or the twenty fixtures is read here. The split for
 * training is by FAMILY (the sheet id before the variant), never by candidate
 * and never by variant: A-101__clean and A-101__skia are the same drawing
 * through two printers, and putting one in train and the other in test would
 * be scoring a model on a sheet it has seen.
 *
 * Diagnostic only — `zz` keeps it out of the gating suite.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allSheets, buildKey, displayMap, primsForCase, sheetForVariant, variantsFor, VARIANTS } from "./cases";
import { writePdf } from "./writers";
import { findWalls } from "./harness";
import { FEATURE_NAMES } from "../wallFeatures";
import type { WallCandidate } from "../wallVectors";

const OUT = process.env.EXTRACT_OUT ?? "";

type Line = { x1: number; y1: number; x2: number; y2: number };

const lengthOf = (s: Line) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

const parallelism = (a: Line, b: Line) => {
  const la = lengthOf(a) || 1;
  const lb = lengthOf(b) || 1;
  return Math.abs(((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb));
};

const offLine = (s: Line, px: number, py: number) => {
  const len = lengthOf(s) || 1;
  return Math.abs(-(px - s.x1) * ((s.y2 - s.y1) / len) + (py - s.y1) * ((s.x2 - s.x1) / len));
};

const overlapOf = (a: Line, b: Line) => {
  const len = lengthOf(a) || 1;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return Math.max(0, hi - lo);
};

describe.skipIf(OUT === "")("training rows from the bench", () => {
  it("writes one row per candidate pairing", async () => {
    writeFileSync(OUT, "", "utf8");
    const sheets = allSheets();
    let rows = 0;
    let positives = 0;
    const families = new Set<string>();

    for (const base of sheets) {
      for (const vid of variantsFor(base.id)) {
        const variant = VARIANTS.find((x) => x.id === vid);
        if (variant === undefined || variant.producer === "skia") continue; // needs Chromium
        const sheet = sheetForVariant(base.id, vid, sheets);
        const key = buildKey(sheet, variant);
        // ── THE ZERO-WALL SHEETS ARE THE MOST VALUABLE NEGATIVES ──
        //
        // A cover sheet, an elevation, a schedule and a reflected ceiling plan
        // have no walls at all, so every candidate on them is a label-0 example
        // — and they are precisely where the errors this is aimed at live: grid
        // lines, table rules, ceiling grid, stair treads. Skipping them would
        // train the model only on sheets where most things ARE walls.
        const prims = primsForCase(sheet, variant);
        const bytes = writePdf(sheet, prims, { compress: true, ...(variant.pdf?.(sheet) ?? {}) });

        const inScope = key.expectWalls
          ? key.walls.filter((w) => w.inScope && w.display !== null && w.clFt >= 2)
          : [];
        const anyWall = key.walls.find((w) => w.display !== null);
        if (anyWall === undefined) continue;
        const fpu = anyWall.trueFeetPerUnit;

        // THE LABEL: does this candidate lie along a key wall, at its
        // thickness? Geometry only — the key says where every wall is, so no
        // judgement is involved and no grader has to be reimplemented.
        const isAWall = (wall: WallCandidate) => {
          const mid = { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
          return inScope.some((kw) => {
            const line = kw.display as Line;
            if (parallelism(line, wall) < 0.98) return false;
            const halfUnits = kw.thicknessIn / 12 / 2 / fpu;
            if (offLine(line, mid.x, mid.y) > halfUnits * 1.5) return false;
            if (overlapOf(line, wall) < 0.5 * Math.min(lengthOf(line), lengthOf(wall))) return false;
            return Math.abs(wall.thicknessFeet * 12 - kw.thicknessIn) <= 1.5;
          });
        };

        const batch: string[] = [];
        await findWalls(bytes, fpu, {
          onCandidate: (features: number[], wall: WallCandidate) => {
            const label = isAWall(wall) ? 1 : 0;
            if (label === 1) positives += 1;
            rows += 1;
            batch.push(
              JSON.stringify({
                case: key.caseId,
                family: base.id,
                features,
                label,
                // The metric is in FEET, so the row carries its own.
                lengthFt: wall.lengthFeet,
              }),
            );
          },
        });
        if (batch.length > 0) appendFileSync(OUT, `${batch.join("\n")}\n`, "utf8");
        families.add(base.id);
      }
    }

    console.log(`\n${rows.toLocaleString()} candidate rows from ${families.size} families`);
    console.log(`  positives: ${positives.toLocaleString()} (${((positives / rows) * 100).toFixed(1)}%)`);
    console.log(`  features:  ${FEATURE_NAMES.length} — ${FEATURE_NAMES.join(", ")}`);
    console.log(`  wrote ${OUT}`);
    // A run that labels nothing positive would train a model that says "no" to
    // everything and score suspiciously well on an unbalanced set.
    // Read back rather than trust the counter: this asserts the FILE exists
    // and holds what was counted, so a write that silently failed cannot be
    // reported as a successful extraction.
    const written = readFileSync(OUT, "utf8").trim().split("\n").filter((l) => l !== "");
    expect(written.length, "nothing was written to EXTRACT_OUT").toBeGreaterThan(1000);
    expect(written.length, "the file and the counter disagree").toBe(rows);
    expect(rows, "no candidates were extracted").toBeGreaterThan(1000);
    expect(positives, "no candidate matched a key wall — the label is broken").toBeGreaterThan(100);
    void displayMap;
  }, 3000000);
});
