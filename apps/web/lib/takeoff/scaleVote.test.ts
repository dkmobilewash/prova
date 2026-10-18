import { describe, expect, it } from "vitest";
import { scaleCandidates, scaleFromDimensions, type DimensionLabel } from "./scaleFromDimensions";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A VOTE IS A LABEL, NOT A STRING ──
 *
 * `scaleFromDimensions` counted DISTINCT TEXT, and the bench carried the
 * resulting defect as a failing probe from the day it was written. P13: eight
 * `30'-0"` bay dimensions, each lettered on its own 270pt line, each
 * independently confirming 1/8" — and the sheet declined with *"Only 1 printed
 * dimension on this sheet agree on a scale"*. Eight witnesses counted as one
 * because they said the same thing.
 *
 * Then a real drawing hit it: fixture S01 letters `24'-6 1/2"` twice and
 * `16'-7 1/4"` twice — four readings in four places — and declined for want of
 * a third.
 *
 * The guard the old rule reached for is real and is kept: one label paired with
 * several candidate lines is ONE reading and several guesses about which line
 * it measures. These cases pin both halves, because a fix that counted
 * CANDIDATES instead would pass the first half and quietly destroy the second.
 */

const PAGE_PT = 1224;
/** 1/8" = 1'-0": a foot is 9 points of paper. */
const PT_PER_FT = 9;

const lineAt = (x: number, y: number, feet: number): StrokeSegment => ({
  x1: x,
  y1: y,
  x2: x + feet * PT_PER_FT,
  y2: y,
});

/** A label lettered on the middle of that line, the way an architect draws it. */
const labelOn = (x: number, y: number, feet: number, text = `${feet}'-0"`): DimensionLabel => ({
  text,
  feet,
  x: x + (feet * PT_PER_FT) / 2,
  y,
});

describe("counting the witnesses", () => {
  it("EIGHT BAYS LETTERED THE SAME ARE EIGHT VOTES — bench probe P13", () => {
    const bays = Array.from({ length: 8 }, (_, i) => ({ x: 100, y: 100 + i * 40 }));
    const segments = bays.map((b) => lineAt(b.x, b.y, 30));
    const labels = bays.map((b) => labelOn(b.x, b.y, 30));

    const verdict = scaleFromDimensions(labels, segments, { pageWidthPt: PAGE_PT });
    expect(verdict.ok, verdict.ok ? "" : verdict.reason).toBe(true);
    if (verdict.ok) expect(verdict.scaleName).toBe('1/8" = 1\'-0"');
  });

  it("FOUR READINGS IN FOUR PLACES, TWO OF EACH TEXT — fixture S01", () => {
    // The shape of a small plan: an overall dimension repeated top and bottom,
    // a depth repeated left and right. Two distinct strings, four witnesses.
    const segments = [
      lineAt(100, 100, 24),
      lineAt(100, 400, 24),
      lineAt(100, 150, 16),
      lineAt(600, 150, 16),
    ];
    const labels = [
      labelOn(100, 100, 24),
      labelOn(100, 400, 24),
      labelOn(100, 150, 16),
      labelOn(600, 150, 16),
    ];
    const verdict = scaleFromDimensions(labels, segments, { pageWidthPt: PAGE_PT });
    expect(verdict.ok, verdict.ok ? "" : verdict.reason).toBe(true);
  });

  it("ONE LABEL NEAR SEVERAL LINES IS STILL ONE VOTE", () => {
    // ── THE HALF A NAIVE FIX DESTROYS ──
    //
    // Counting CANDIDATES rather than labels would pass the two cases above and
    // make this one pass too — which is the failure the distinct rule existed
    // to prevent. One string beside several lines is one reading and several
    // guesses about which line it measures; it cannot confirm itself.
    //
    // Three parallel lines of the SAME length, one label between them, so every
    // pairing agrees on the same scale and only the counting rule decides.
    const segments = [lineAt(100, 100, 30), lineAt(100, 104, 30), lineAt(100, 96, 30)];
    const labels = [labelOn(100, 100, 30)];

    const candidates = scaleCandidates(labels, segments);
    // The control: this label really does pair with more than one line, so the
    // case is about the counting rule rather than about pairing.
    expect(candidates.length, "the label paired with one line — this no longer tests the rule").toBeGreaterThan(1);

    const verdict = scaleFromDimensions(labels, segments, { pageWidthPt: PAGE_PT });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/agree on a scale|too few/i);
  });

  it("names the TEXTS as evidence, not the internal keys", () => {
    // `agreed` is the sentence an estimator reads. A label's identity carries
    // its coordinates, and `24'-6 1/2"@131.0,512.0` is not evidence to a person.
    const segments = [lineAt(100, 100, 30), lineAt(100, 200, 30), lineAt(100, 300, 20)];
    const labels = [labelOn(100, 100, 30), labelOn(100, 200, 30), labelOn(100, 300, 20)];
    const verdict = scaleFromDimensions(labels, segments, { pageWidthPt: PAGE_PT });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      for (const shown of verdict.agreed) {
        expect(shown, `"${shown}" leaks a coordinate into the evidence sentence`).not.toMatch(/@[\d.]+,/);
      }
      // And the repeated text is shown once rather than twice.
      expect(new Set(verdict.agreed).size).toBe(verdict.agreed.length);
    }
  });
});
