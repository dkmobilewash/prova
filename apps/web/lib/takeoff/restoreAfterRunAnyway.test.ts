/**
 * RESTORE SURVIVES THE "RUN ANYWAY" PATH, AND SAYS SO WHEN IT CANNOT RUN YET.
 *
 * Chrome reported Bunkie A100 reopening as "12 of 69 reviewed, 0 walls, no
 * restore notice, blank reviewer" while its file — 23 accepted, 58 refused, 3
 * traced — sat on disk intact. Nothing was lost. The restore never ran and
 * nothing said so, which from the reviewer's side is the same thing as losing
 * an afternoon.
 *
 * Two defects, pinned here as source structure because the restore lives in an
 * effect inside a component that needs a plan, a session and a PDF to render —
 * none of which this suite can produce. That is a real limit and the reason
 * each assertion names the behaviour it is standing in for:
 *
 *   1. the one attempt per sheet must be spent on an ANSWER, not on having
 *      tried: `triedSaved` before the fetch meant a failed response disabled
 *      restore for that sheet permanently and silently;
 *   2. a sheet with no candidates yet — the "Run anyway" sheet, before the
 *      reviewer presses Find the walls — must still report that a file exists.
 *
 * Comments are stripped before matching, per `clerkMountGate.test.ts`: the
 * file being read documents this bug at length and its prose contains the very
 * strings these assertions forbid.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKSPACE = new URL("../../components/TakeoffWorkspace.tsx", import.meta.url).pathname;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const source = strip(readFileSync(WORKSPACE, "utf8"));

describe("the saved-label restore", () => {
  it("read a workspace that really does restore", () => {
    // Without this the assertions below could pass over the wrong file.
    expect(source, "the workspace does not call restoreSaved at all").toContain("restoreSaved(");
    expect(source).toContain("triedSaved");
  });

  it("spends the sheet's one attempt only on a definite answer", () => {
    // Exactly two marks: the server saying there is no file, and a file that
    // was read. A third would most likely be a transport path creeping back.
    const marks = source.match(/triedSaved\.current = sheetKey;/g) ?? [];
    expect(marks.length, "the attempt is marked somewhere other than the two definite outcomes").toBe(2);
  });

  it("does NOT mark the attempt before the fetch", () => {
    // The original bug, stated as the thing that must not reappear: the mark
    // sitting above the request means any failure spends the attempt.
    const atFetch = source.indexOf("await fetch(");
    const firstMark = source.indexOf("triedSaved.current = sheetKey;");
    expect(atFetch, "no fetch found in the workspace").toBeGreaterThan(-1);
    expect(
      firstMark > atFetch,
      "triedSaved is set before the first fetch, so a failed response will disable restore for the sheet",
    ).toBe(true);
  });

  it("does NOT skip a sheet that has no candidates, because traces do not need any", () => {
    // Michigan State A3, round 8: 20 traces on disk, "0 of 0" on screen. The
    // finder offers nothing on a single-line renovation plan, and the restore
    // used to return before asking — so the one sheet that proves the bug was
    // the one it skipped.
    //
    // A trace is standalone geometry, not a verdict ON a candidate, so an
    // empty candidate list is no reason to skip. The guard must be gone, not
    // softened into a notice: announcing the file while still not loading it
    // leaves the sheet broken and tells the reviewer it is fine.
    expect(
      source,
      "the zero-candidate early return is back, so a trace-only sheet will not restore",
    ).not.toMatch(/if \(current\.candidates\.length === 0\)/);
    expect(source, "the restore no longer runs for a sheet with no candidates").toContain("restoreSaved(");
  });

  it("does not restore into a review that already has work", () => {
    // Unchanged and worth keeping next to the rest: the baseline guard is what
    // stops a reopen overwriting a reviewer mid-sheet.
    expect(source).toContain("if (decided > baselineDecided.current.count) return;");
  });
});
