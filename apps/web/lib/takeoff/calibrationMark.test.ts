import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLUSTER_COLOURS, DISTINCT_MARKS, markFor } from "./clusterMarks";

/**
 * ── THE SCALE LINE IS NOT A WALL RUN, AND MUST NOT LOOK LIKE ONE ──
 *
 * Reported as a bug from two real sheets: an orange dashed run crossing the
 * whole drawing on Camp Bow Wow A102 and on Eleven03 A4.B.1, at about the same
 * height on both. It was neither a detected run nor an overlay fault — it was
 * the SCALE CALIBRATION, the two points somebody dragged to set the scale,
 * crossing the drawing because a long calibration line is an accurate one.
 *
 * The confusion was real and was ours. The calibration drew as `#f0b429` even
 * dashes; `CLUSTER_COLOURS[4]` is `#fbbf24`. That is rgb(240,180,41) against
 * rgb(251,191,36) — a Euclidean distance of about 16 in a space whose diagonal
 * is 441, which is to say no difference — and both were drawn as even dashes
 * of a similar length. So on any sheet carrying five or more thickness groups,
 * one group's runs and the scale line were the same mark. A102 has more than
 * five.
 *
 * ── FIXED BY SHAPE, AND THIS IS WHY ──
 *
 * Not by moving a colour. The palette is tuned, its collision history is
 * written into `clusterMarks.ts`, and a swap risks a new collision inside it.
 * The scale line is a different KIND of thing from a wall run, so it gets a
 * different kind of mark: a dash-DOT, which is what a drafter draws for a
 * reference line, and which `markFor` cannot produce at any index because a
 * cluster dash is always exactly two lengths.
 *
 * That last clause is the one worth a test. A colour comparison would go stale
 * the moment somebody retunes the palette; "no cluster dash has four parts" is
 * a structural property of `markFor` and stays true however it is retuned.
 */

const VIEWER = resolve(__dirname, "../../components/TakeoffPlanViewer.tsx");

/** The dash the scale line is drawn with, read from the component. */
function calibrationDash(): string {
  const source = readFileSync(VIEWER, "utf8");
  const match = source.match(/export const CALIBRATION_DASH = `([^`]+)`/);
  expect(match, "no CALIBRATION_DASH in the viewer — has it been renamed?").not.toBeNull();
  // Evaluate the two template expressions the way the component does.
  return (match as RegExpMatchArray)[1]
    .replace(/\$\{STROKE_PX \* (\d+)\}/g, (_, n: string) => String(2 * Number(n)))
    .replace(/\$\{STROKE_PX\}/g, "2");
}

describe("the scale line cannot be mistaken for a wall run", () => {
  it("is a DASH-DOT: four lengths, where every cluster dash has two", () => {
    const parts = calibrationDash().trim().split(/\s+/);
    expect(parts).toHaveLength(4);
    for (const part of parts) expect(Number(part)).toBeGreaterThan(0);
  });

  it("differs from EVERY mark the palette can produce, at every index", () => {
    // Not the six it happens to use today — every index `markFor` accepts,
    // past the point where marks start repeating, so a bigger palette or an
    // extra dash cannot quietly collide with this line.
    const dash = calibrationDash();
    for (let index = 0; index < DISTINCT_MARKS * 3; index += 1) {
      const mark = markFor(index, 2);
      expect(mark.dash, `cluster ${index} drew the scale line's dash`).not.toBe(dash);
      // The structural reason, asserted rather than assumed: a cluster dash is
      // two numbers. If that ever changes, this fails here rather than on a
      // drawing somebody is reading.
      expect(mark.dash.trim().split(/\s+/)).toHaveLength(2);
    }
  });

  it("records the colour collision that made this necessary", () => {
    // The palette is deliberately NOT changed, so the twin is still there —
    // and that is fine now that the shape carries the distinction. This asserts
    // the situation is what the comment above says it is, so the next person
    // reading that explanation can trust it.
    expect(CLUSTER_COLOURS).toContain("#fbbf24");
    const scale = [0xf0, 0xb4, 0x29];
    const twin = [0xfb, 0xbf, 0x24];
    const distance = Math.hypot(...scale.map((channel, i) => channel - twin[i]));
    expect(distance, "the colours are no longer twins — this entry needs rewriting").toBeLessThan(
      25,
    );
  });
});
