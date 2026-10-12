import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FINDER ONLY KNOWS WHAT THIS SCREEN HANDS IT.
 *
 * `wallsFromStrokes` prefers a pair whose thickness is a type the company
 * builds, defers its 2.4in floor to that list, and refuses a pair that is a
 * wider scheduled wall's own layer line. Every one of those is measured in
 * `lib/takeoff/wallVectors.test.ts` AND EVERY ONE OF THEM IS INERT WITHOUT THE
 * LIST. Delete `knownThicknessesIn` from the one call site in the app and the
 * finder quietly returns to reading a block wall and the furring on it as a
 * single 9-1/2in wall — with the whole suite green, because every test of the
 * behaviour passes the list in itself.
 *
 * That is this repo's "written, documented, and never called" shape, and
 * mutation found it: removing the argument from `TakeoffPlanViewer` left 240
 * tests passing.
 *
 * A census is the right instrument here and a render test is not, which is the
 * opposite of the usual answer in this directory. `takeoffWallFinder.test.tsx`
 * says why in its own header — detection needs a real PDF and pdf.js, so no
 * rendered test in happy-dom can run the finder at all. But there is no
 * framework in between to drop anything: the list is an argument to a function
 * call in the same module. If the text says it is passed, it is passed.
 *
 * Comments are STRIPPED before anything is matched. Both this file and the
 * viewer discuss `knownThicknessesIn` in prose, and a census that reads its own
 * subject matter in a comment is the #185 defect.
 */
const SOURCE = resolve(import.meta.dirname, "TakeoffPlanViewer.tsx");

/** Source with block and line comments removed, so prose cannot satisfy a test. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/[^\n]*$/gm, "");
}

describe("the viewer hands the partition schedule to the wall finder", () => {
  const code = withoutComments(readFileSync(SOURCE, "utf8"));

  it("PARSES THE CALL AT ALL — a pattern matching nothing must fail loudly", () => {
    // The size assertion this directory requires: a census that silently stops
    // finding its subject passes every assertion downstream of it.
    const calls = code.match(/wallsFromBothEngines\(/g) ?? [];
    expect(calls, "no call to wallsFromBothEngines survived the comment strip").toHaveLength(1);
  });

  it("PASSES knownThicknessesIn in that call", () => {
    const at = code.indexOf("wallsFromBothEngines(");
    expect(at, "the call is not in this file any more").toBeGreaterThan(-1);
    // The options object is the last argument; read to the end of the call.
    const call = code.slice(at, code.indexOf(");", at));
    expect(call, "the finder is called without the schedule").toContain("knownThicknessesIn");
  });

  it("drops the types whose thickness nobody has filled in", () => {
    // `thicknessIn` is nullable on a wall type — a company can name an assembly
    // before measuring it. A null reaching the finder would be compared against
    // every candidate thickness and match nothing, which is harmless, but it
    // would also make the list's length lie about how much is known.
    expect(code).toMatch(/thicknessIn[\s\S]{0,200}?!==\s*null/);
  });
});
