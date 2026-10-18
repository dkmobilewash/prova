import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── THERE IS ONE CURRENT SHEET, AND BOTH COMPONENTS MUST AGREE ON IT ──
 *
 * The bug this pins, in one sentence: `TakeoffPlanViewer` owns `pageNumber`
 * and its own picker changes it, `TakeoffWorkspace` owns `page` and only the
 * sheet TREE changed that, and nothing went the other way — so picking a sheet
 * from the picker moved the drawing and left the workspace keying everything
 * to the sheet it still believed it was on. A102's answer-key candidates, its
 * verdicts and its traced wall were drawn on A103, and a key saved afterwards
 * would have carried A103's sheet number and A103's scale.
 *
 * ── WHY THIS IS A SOURCE CENSUS AND NOT A RENDERED TEST ──
 *
 * It would be better as a rendered test and it cannot be one. `wallGroups.ts`
 * explains why in its own header: the viewer opens on page 1 and its pager
 * only exists once a real PDF has reported `numPages`, which never happens in
 * happy-dom. No DOM test can put the viewer on page 2, so no DOM test can
 * watch it tell anybody.
 *
 * `e2e/specs/takeoff-key-one-sheet.spec.ts` is where the behaviour is proved,
 * in a real browser on a real set. This is the cheap guard that the wiring it
 * depends on is still there — a census can see that a prop is passed, and
 * CLAUDE.md is clear that it can never see that the prop does anything. The
 * two are not interchangeable and both are here on purpose.
 */

const dir = join(import.meta.dirname);
const workspace = readFileSync(join(dir, "TakeoffWorkspace.tsx"), "utf8");
const viewer = readFileSync(join(dir, "TakeoffPlanViewer.tsx"), "utf8");

/** Comments quote the code they explain, and this file's style is to explain
 *  at length — so every check below reads the source with them stripped. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const workspaceCode = withoutComments(workspace);
const viewerCode = withoutComments(viewer);

describe("one current sheet", () => {
  it("the census can see both files, so it is not passing on nothing", () => {
    // The anti-vacuity check every census here carries: a path that stopped
    // resolving would make every assertion below true of an empty string.
    expect(workspaceCode.length).toBeGreaterThan(10_000);
    expect(viewerCode.length).toBeGreaterThan(10_000);
    expect(workspaceCode).toContain("TakeoffPlanViewer");
  });

  it("THE WORKSPACE IS TOLD WHICH SHEET THE VIEWER IS SHOWING", () => {
    expect(
      /onPageChange=\{setPage\}/.test(workspaceCode),
      "the workspace does not follow the viewer's sheet, so everything it keys by page can belong to another one",
    ).toBe(true);
  });

  it("and the viewer reports it whenever its own page changes", () => {
    expect(
      /onPageChange\?\.\(pageNumber\)/.test(viewerCode),
      "the viewer never tells anybody its page changed",
    ).toBe(true);
    // In an effect ON `pageNumber`, so it fires for the picker, the keyboard
    // and a `takeoff-goto` alike rather than from one handler somebody
    // remembered.
    const effect = viewerCode.match(
      /useEffect\(\(\) => \{[^}]*onPageChange\?\.\(pageNumber\)[\s\S]{0,400}?\}, \[([^\]]*)\]\)/,
    );
    expect(effect, "the report is not in an effect keyed on the page").not.toBeNull();
    expect(effect![1]).toContain("pageNumber");
  });

  it("a half-drawn trace does not survive a sheet change", () => {
    // The smaller leak of the same shape: `traceFrom`/`traceTo` are the
    // viewer's own state and were keyed to no sheet at all, so a trace begun
    // on one drawing could be finished on the next.
    const effect = viewerCode.match(
      /useEffect\(\(\) => \{[^}]*onPageChange\?\.\(pageNumber\)[\s\S]{0,400}?\}, \[[^\]]*\]\)/,
    );
    expect(effect).not.toBeNull();
    for (const cleared of ["setTraceFrom(null)", "setTraceTo(null)"]) {
      expect(effect![0], `${cleared} is missing, so a trace crosses sheets`).toContain(cleared);
    }
  });

  it("every piece of answer-key state is read through the per-sheet helper", () => {
    // Candidates, verdicts, traced walls, the set-aside count and the "offer
    // these too" override all go through `onThisSheet`. A new one added beside
    // them with a plain `useState` is the way this broke the first time.
    for (const byPage of [
      "keyStateByPage",
      "keyFocusByPage",
      "setAsideByPage",
      "offerAllByPage",
      "tracingByPage",
    ]) {
      expect(
        new RegExp(`onThisSheet\\(${byPage}`).test(workspaceCode),
        `${byPage} is not read through onThisSheet`,
      ).toBe(true);
    }
  });
});
