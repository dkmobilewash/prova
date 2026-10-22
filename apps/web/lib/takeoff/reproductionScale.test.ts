import { describe, expect, it } from "vitest";
import { reproductionCaution, reproductionReading } from "./reproductionScale";
import type { ScaleVerdict } from "./scaleFromDimensions";

const declined = (vote: NonNullable<Extract<ScaleVerdict, { ok: false }>["vote"]> | undefined): ScaleVerdict => ({
  ok: false,
  reason: "the best line is too short",
  considered: 40,
  ...(vote === undefined ? {} : { vote }),
});
const sixteenth = { name: '1/16" = 1\'-0"', feetPerInch: 16 };

describe("a reproduction: dimensions at exactly twice or half the printed scale", () => {
  it("takes the vote when it is 2x the printed scale, clear, and a majority of what measured", () => {
    const got = reproductionReading({
      verdict: declined({ scaleName: '1/32" = 1\'-0"', feetPerInch: 32, votes: 24, agreed: ["20' - 0\"", "12' - 6\""], measured: 40 }),
      printed: sixteenth,
    });
    expect(got?.factor).toBe(2);
    expect(got?.scaleName).toBe('1/32" = 1\'-0"');
    expect(got?.agreed).toHaveLength(2);
  });

  it("takes half as well — a double-size print says 1/32 and measures 1/16", () => {
    const got = reproductionReading({
      verdict: declined({ scaleName: '1/16" = 1\'-0"', feetPerInch: 16, votes: 20, agreed: [], measured: 30 }),
      printed: { name: '1/32" = 1\'-0"', feetPerInch: 32 },
    });
    expect(got?.factor).toBe(0.5);
  });

  it("REFUSES A PLURALITY — Topeka G-100b's shape: 10 of 45 at 1/32 against a printed 1/16", () => {
    const got = reproductionReading({
      verdict: declined({ scaleName: '1/32" = 1\'-0"', feetPerInch: 32, votes: 10, agreed: [], measured: 45 }),
      printed: sixteenth,
    });
    expect(got).toBeNull();
  });

  it("refuses any factor that is not exactly two: 3/32 against 1/8 is a different drawing, not a print", () => {
    expect(reproductionReading({ verdict: declined({ scaleName: '3/32" = 1\'-0"', feetPerInch: 32 / 3, votes: 30, agreed: [], measured: 32 }), printed: { name: '1/8" = 1\'-0"', feetPerInch: 8 } })).toBeNull();
    expect(reproductionReading({ verdict: declined({ scaleName: '1/4" = 1\'-0"', feetPerInch: 4, votes: 30, agreed: [], measured: 32 }), printed: sixteenth })).toBeNull();
  });

  it("refuses without a printed scale, without a vote, with too few votes, or when the dimensions already answered", () => {
    const vote = { scaleName: '1/32" = 1\'-0"', feetPerInch: 32, votes: 24, agreed: [], measured: 40 };
    expect(reproductionReading({ verdict: declined(vote), printed: null })).toBeNull();
    expect(reproductionReading({ verdict: declined(undefined), printed: sixteenth })).toBeNull();
    expect(reproductionReading({ verdict: declined({ ...vote, votes: 2, measured: 3 }), printed: sixteenth })).toBeNull();
    const ok: ScaleVerdict = { ok: true, scaleName: '1/32" = 1\'-0"', feetPerInch: 32, best: { x1: 0, y1: 0, x2: 1, y2: 0, declaredFeet: 10, text: "10'", labelKey: "a", feetPerInch: 32 }, agreed: [], considered: 40, inheritedError: 0 };
    expect(reproductionReading({ verdict: ok, printed: sixteenth })).toBeNull();
  });

  it("says what it did in the estimator's words, naming both scales", () => {
    const text = reproductionCaution('1/16" = 1\'-0"', '1/32" = 1\'-0"', 2);
    expect(text).toContain("printed at half size; scale taken from its dimensions");
    expect(text).toContain('1/16" = 1\'-0"');
    expect(text).toContain('1/32" = 1\'-0"');
  });
});
