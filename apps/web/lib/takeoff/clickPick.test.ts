import { describe, expect, it } from "vitest";
import { distanceToSegment, pickOnClick, type PickableCandidate } from "./clickPick";

/**
 * ── THE BUG THIS EXISTS FOR ──
 *
 * A pre-rejected grey candidate could not be selected by clicking the
 * drawing; only its row in the panel worked. Its accepted twin was drawn on
 * top of it — the pair is offset by inches of building, and every line is the
 * same few SCREEN pixels wide because of `non-scaling-stroke`, so at any
 * sensible zoom they are the same pixels and SVG gives the click to whichever
 * it painted last.
 */
const line = (id: string, y: number, x1 = 0.1, x2 = 0.5): PickableCandidate => ({
  id,
  x1,
  y1: y,
  x2,
  y2: y,
});

// The real case: nine inches on a 288 ft sheet.
const NINE_INCHES = 9 / 12 / 288;

describe("picking a candidate by clicking the drawing", () => {
  const twin = [line("accepted", 0.2), line("grey", 0.2 + NINE_INCHES)];

  it("a lone candidate is picked, as before", () => {
    const got = pickOnClick({ candidates: [line("only", 0.2)], x: 0.3, y: 0.2, focusedId: null });
    expect(got).toBe("only");
  });

  it("THE COVERED TWIN IS REACHABLE BY CLICKING AGAIN", () => {
    // Click once: the nearer one. Click the same place again: the other.
    const first = pickOnClick({ candidates: twin, x: 0.3, y: 0.2, focusedId: null });
    expect(first).toBe("accepted");
    const second = pickOnClick({ candidates: twin, x: 0.3, y: 0.2, focusedId: first });
    expect(second, "the grey twin could not be reached").toBe("grey");
  });

  it("cycles back round, so a third click returns to the first", () => {
    const third = pickOnClick({ candidates: twin, x: 0.3, y: 0.2, focusedId: "grey" });
    expect(third).toBe("accepted");
  });

  it("clicking a DIFFERENT place picks the nearest there, not the next in a cycle", () => {
    const elsewhere = [...twin, line("other", 0.6)];
    const got = pickOnClick({
      candidates: elsewhere,
      x: 0.3,
      y: 0.6,
      focusedId: "accepted",
    });
    expect(got).toBe("other");
  });

  it("ignores candidates nowhere near the click", () => {
    const got = pickOnClick({
      candidates: [line("far", 0.9)],
      x: 0.3,
      y: 0.2,
      focusedId: null,
      clicked: null,
    });
    expect(got).toBeNull();
  });

  it("falls back to what SVG delivered when nothing is in radius", () => {
    // The stroke can be drawn wider than the radius allows for, so a click
    // that SVG itself resolved must not become a no-op.
    const got = pickOnClick({
      candidates: [line("far", 0.9)],
      x: 0.3,
      y: 0.2,
      focusedId: null,
      clicked: "far",
    });
    expect(got).toBe("far");
  });

  it("does not claim a wall the click is past the END of", () => {
    // Distance to the SEGMENT, not to its infinite line: a wall's line
    // stretches across the whole sheet and would swallow clicks a room away.
    const got = pickOnClick({
      candidates: [line("short", 0.2, 0.1, 0.15)],
      x: 0.8,
      y: 0.2,
      focusedId: null,
      clicked: null,
    });
    expect(got).toBeNull();
  });

  it("orders ties by id, so the cycle is stable rather than following paint order", () => {
    // Two candidates exactly the same distance away. Which one is "first"
    // must not depend on the order they happen to arrive in, or the second
    // click lands somewhere different each time.
    const same = [line("b", 0.2), line("a", 0.2)];
    expect(pickOnClick({ candidates: same, x: 0.3, y: 0.2, focusedId: null })).toBe("a");
    expect(pickOnClick({ candidates: [...same].reverse(), x: 0.3, y: 0.2, focusedId: null })).toBe(
      "a",
    );
  });

  it("three overlapping candidates take three clicks", () => {
    // The radius is passed explicitly, and that is the point rather than a
    // convenience: the third line is 18 inches off, which the DEFAULT radius
    // (about 14 inches at this scale) deliberately excludes. How far a click
    // reaches is the caller's decision, because it depends on the zoom and on
    // how wide the stroke is painted — a fixed value would be generous at one
    // zoom and unreachable at another.
    const three = [
      line("one", 0.2),
      line("two", 0.2 + NINE_INCHES),
      line("three", 0.2 + 2 * NINE_INCHES),
    ];
    const at = { candidates: three, x: 0.3, y: 0.2, radius: 0.008 };
    const a = pickOnClick({ ...at, focusedId: null });
    const b = pickOnClick({ ...at, focusedId: a });
    const c = pickOnClick({ ...at, focusedId: b });
    expect(new Set([a, b, c]).size, "a candidate was unreachable").toBe(3);
    expect(pickOnClick({ ...at, focusedId: c })).toBe(a);
  });

  it("the DEFAULT radius leaves a wall a room away alone", () => {
    // The companion to the case above: widening the reach has a cost, and
    // the default must not claim something a reviewer would never mean.
    const twenty = 20 / 288; // 20 ft on a 288 ft sheet
    const got = pickOnClick({
      candidates: [line("next room", 0.2 + twenty)],
      x: 0.3,
      y: 0.2,
      focusedId: null,
      clicked: null,
    });
    expect(got).toBeNull();
  });
});

describe("distance to a segment", () => {
  it("is measured perpendicular when the point is alongside", () => {
    expect(distanceToSegment(line("a", 0.2), 0.3, 0.25)).toBeCloseTo(0.05);
  });

  it("is measured to the END when the point is past it", () => {
    expect(distanceToSegment(line("a", 0.2, 0.1, 0.5), 0.6, 0.2)).toBeCloseTo(0.1);
  });

  it("handles a zero-length candidate without dividing by zero", () => {
    expect(distanceToSegment({ id: "p", x1: 0.2, y1: 0.2, x2: 0.2, y2: 0.2 }, 0.3, 0.2)).toBeCloseTo(
      0.1,
    );
  });
});
