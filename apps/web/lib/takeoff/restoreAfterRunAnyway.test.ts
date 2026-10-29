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

  it("reports a saved file even when there is nothing to restore into", () => {
    // The Run-anyway case: no candidates yet, so no verdicts can be placed,
    // but the reviewer must not be shown an empty panel in silence.
    const guard = source.indexOf("current.candidates.length === 0");
    expect(guard, "the no-candidates guard is gone").toBeGreaterThan(-1);
    const afterGuard = source.slice(guard, guard + 1800);
    expect(afterGuard, "the empty-sheet branch never asks whether a file exists").toContain("await fetch(");
    expect(afterGuard, "the empty-sheet branch does not tell the reviewer anything").toContain("setSavedNotice(");
    expect(afterGuard, "the notice must say the work is safe").toMatch(/NOT been loaded|has NOT been/);
    expect(afterGuard, "the notice must say what to press").toMatch(/Run anyway/);
  });

  it("does not restore into a review that already has work", () => {
    // Unchanged and worth keeping next to the rest: the baseline guard is what
    // stops a reopen overwriting a reviewer mid-sheet.
    expect(source).toContain("if (decided > baselineDecided.current.count) return;");
  });
});
