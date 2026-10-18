import { describe, expect, it } from "vitest";
import { defaultWallTypeFromNotes } from "./wallNotes";
import type { MatchableWallType } from "./wallTypeMatch";

/**
 * ── THE DRAWING ALREADY ANSWERED THE QUESTION THE PANEL WAS ASKING ──
 *
 * Found by clicking School-01's A-101, 2026-10-11. The largest group on the
 * sheet — 29 runs, 577 ft, about 30% of its footage — carried no tag, so the
 * panel asked "which type?" and offered A1, A2 or C1 as equals. General Note 1
 * on that same sheet reads "1. ALL PARTITIONS TYPE A1 U.N.O.", and an estimator
 * who picked A2 from that dropdown would have mis-priced the biggest group on
 * the drawing.
 *
 * The note arrives as ONE text item on every sheet of that set — measured, not
 * assumed — so no line joining is needed here.
 *
 * The cases that matter most are the REFUSALS. This reads a sentence off a
 * drawing and turns it into money, so what it declines to act on is the
 * safety.
 */
const type = (code: string, thicknessIn: number | null): MatchableWallType => ({
  id: `wt_${code}`,
  code,
  name: `${code} partition`,
  hasParts: true,
  thicknessIn,
});

const LIBRARY = [type("A1", 4.875), type("A2", 4.875), type("B1", 7.25), type("EXT-1", 8.875)];
const items = (...lines: string[]) => lines.map((str) => ({ str }));

describe("the wall type a sheet's general notes make the default", () => {
  it("READS THE NOTE OFF THE REAL SHEET, verbatim as it arrives", () => {
    const found = defaultWallTypeFromNotes(
      items("GENERAL NOTES", "1. ALL PARTITIONS TYPE A1 U.N.O.", "2. SEE A-501 FOR PARTITION TYPES"),
      LIBRARY,
    );
    expect(found?.type.code).toBe("A1");
    expect(found?.note, "the note is not quoted exactly").toBe("1. ALL PARTITIONS TYPE A1 U.N.O.");
  });

  it("IGNORES THE NOTE THAT NAMES A SHEET, which sits right under it", () => {
    // "2. SEE A-501 FOR PARTITION TYPES" mentions PARTITION and a code-shaped
    // string. It names where the schedule is, not what the walls are. Without
    // the ALL anchor this matches, and A-501 is not a wall type anyway — two
    // independent reasons it is refused, and the test asserts the outcome.
    const found = defaultWallTypeFromNotes(items("2. SEE A-501 FOR PARTITION TYPES"), LIBRARY);
    expect(found).toBeNull();
  });

  it("REFUSES A SHEET REFERENCE THAT COLLIDES WITH A WALL TYPE — the ALL anchor alone", () => {
    // The case that makes the anchor load-bearing rather than belt-and-braces,
    // and it was blind until a mutation said so. "A-501" is refused twice over
    // — no ALL, and not in the library — so dropping the anchor changed
    // nothing and no test noticed.
    //
    // Plenty of small sets number their sheets A1, A2, A3. Those are also the
    // two commonest partition codes there are. On such a set "SEE A1 FOR
    // PARTITION TYPES" points at a SHEET, and without the anchor it would be
    // read as "every untagged wall is type A1" — the whole drawing priced off
    // a cross-reference.
    const found = defaultWallTypeFromNotes(items("2. SEE A1 FOR PARTITION TYPES"), LIBRARY);
    expect(found, "a sheet cross-reference was read as a default wall type").toBeNull();
  });

  it("REFUSES A CODE THE COMPANY DOES NOT HAVE, which is the library acting as the filter", () => {
    const found = defaultWallTypeFromNotes(items("1. ALL PARTITIONS TYPE P9 U.N.O."), LIBRARY);
    expect(found).toBeNull();
  });

  it("ignores the OTHER U.N.O. note on the same sheet", () => {
    // "4. DIMENSIONS ARE TO FACE OF STUD OR GRID U.N.O." is on every sheet of
    // the set and says nothing about wall types.
    const found = defaultWallTypeFromNotes(
      items("4. DIMENSIONS ARE TO FACE OF STUD", "OR GRID U.N.O.", "5. DO NOT SCALE DRAWINGS"),
      LIBRARY,
    );
    expect(found).toBeNull();
  });

  it("accepts the spellings architects actually write", () => {
    for (const line of [
      "ALL PARTITIONS ARE TYPE A1 UNLESS NOTED OTHERWISE",
      "1. ALL INTERIOR PARTITIONS TYPE A1 U.N.O.",
      "ALL NEW PARTITIONS: A1",
      "all partitions type a1 u.n.o.",
      "ALL PARTITION TYPE A1 U.N.O.",
    ]) {
      expect(defaultWallTypeFromNotes(items(line), LIBRARY)?.type.code, line).toBe("A1");
    }
  });

  it("matches the library the way the catalogue does, not by string equality", () => {
    expect(defaultWallTypeFromNotes(items("ALL PARTITIONS TYPE EXT 1 U.N.O."), LIBRARY)?.type.code)
      .toBe("EXT-1");
  });

  it("returns null with no wall types at all, rather than inventing one", () => {
    expect(defaultWallTypeFromNotes(items("1. ALL PARTITIONS TYPE A1 U.N.O."), [])).toBeNull();
  });

  it("prefers the code the library knows when a note mentions a sheet first", () => {
    // A wordier note: the sheet reference comes first and is not a wall type,
    // so the library picks the one that is.
    const found = defaultWallTypeFromNotes(
      items("1. ALL PARTITIONS PER A-501 TO BE TYPE A1 U.N.O."),
      LIBRARY,
    );
    expect(found?.type.code).toBe("A1");
  });
});
