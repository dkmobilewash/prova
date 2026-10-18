import { countReportedBoxes, readTextBoxes } from "@prova/integrations";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── "READ 0 WORDS" WAS ONE SENTENCE FOR TWO DIFFERENT FAILURES ──
 *
 * A browser tester ran this on a real scanned sheet. Fifteen requests, every
 * one a 200, forty-seven seconds, and then: *"Read 0 words off this sheet."*
 *
 * That sentence is compatible with two unrelated problems:
 *
 *   - the model was handed blank or illegible tiles and correctly found
 *     nothing — a RENDERING fault, ours;
 *   - the model found plenty and every box was discarded for sitting outside
 *     the crop — a COORDINATE fault, also ours, but a different one.
 *
 * Nothing distinguished them, so the next step was a guess. The raw count the
 * model reported is now carried alongside the boxes that survived, and the
 * page says which zero it is.
 *
 * `readTextBoxes` DROPS a bad box rather than clamping it, deliberately — a
 * fabricated coordinate pushed back inside the crop would pair with whatever
 * line happened to be there. That is the right call and it is exactly what
 * makes the two cases look identical from outside, which is why the count has
 * to be reported separately rather than inferred.
 */

describe("telling one zero from the other", () => {
  it("counts what the model CLAIMED, not what survived", () => {
    const raw = {
      items: [
        { text: "KITCHEN", x: 0.1, y: 0.2, width: 0.1, height: 0.02 },
        { text: "off the crop", x: 4.0, y: 0.2, width: 0.1, height: 0.02 },
        { text: "inside out", x: 0.1, y: 0.2, width: -0.1, height: 0.02 },
      ],
    };
    expect(countReportedBoxes(raw), "the model reported three items").toBe(3);
    expect(readTextBoxes(raw), "only one of them is usable").toHaveLength(1);
  });

  it("REPORTS ZERO FOR AN EMPTY REPLY, which is the other failure entirely", () => {
    expect(countReportedBoxes({ items: [] })).toBe(0);
    expect(readTextBoxes({ items: [] })).toEqual([]);
  });

  it("does not throw on a reply of the wrong shape", () => {
    for (const junk of [null, undefined, 7, "no", {}, { items: null }, { items: "no" }]) {
      expect(() => countReportedBoxes(junk)).not.toThrow();
      expect(countReportedBoxes(junk)).toBe(0);
    }
  });

  it("IS ACTUALLY WIRED INTO THE REPLY, not merely available to be", () => {
    // A mutation returning a hard-coded `reported: 0` left every case above
    // green: they all exercise `countReportedBoxes` directly, and none of
    // them asked whether the function that TALKS TO THE MODEL uses it. That
    // is this repo's "written, documented and never called" shape, arriving
    // in the test for the thing written to prevent it.
    //
    // A source check, because the alternative is mocking the SDK — weaker
    // than running it, and said so rather than dressed up.
    const source = readFileSync(
      resolve(process.cwd(), "../../packages/integrations/src/sheetText.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source, "the reply must carry the model's own count").toMatch(
      /reported:\s*countReportedBoxes\(\s*raw\s*\)/,
    );
    expect(source, "both halves must come from the SAME reply").toMatch(
      /boxes:\s*readTextBoxes\(\s*raw\s*\)/,
    );
  });

  it("counts loosely ON PURPOSE, so it cannot hide the gap it exists to show", () => {
    // A count that applied the same checks as the reader would always equal
    // the reader, and the two numbers would never differ — which is the one
    // thing that would make this useless.
    const allBad = { items: [{}, {}, { text: "", x: 9, y: 9, width: 9, height: 9 }] };
    expect(countReportedBoxes(allBad)).toBe(3);
    expect(readTextBoxes(allBad)).toEqual([]);
  });
});

describe("the page says which zero it was", () => {
  const VIEWER = readFileSync(
    resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"),
    "utf8",
  );
  const CODE = VIEWER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("has a different sentence for each", () => {
    const panel = CODE.slice(CODE.indexOf('data-takeoff="read-done"'));
    const upToClose = panel.slice(0, panel.indexOf("</p>"));
    expect(upToClose, "a coordinate failure must say so").toMatch(/none could\s+be placed|could not be placed/);
    expect(upToClose, "an unreadable scan must say so").toMatch(/No writing could be made out/);
    // ── THE CONDITION, NOT THE SENTENCE ──
    //
    // This asserted only that `readReported` appeared somewhere in the panel,
    // and a mutation replacing the condition with `false` stayed GREEN —
    // because the sentence INTERPOLATES the same name ("{readReported} pieces
    // of writing were found"). The test was reading the number being printed
    // and calling it the branch being taken.
    expect(upToClose, "the branch must key on the reported COUNT, not merely print it").toMatch(
      /readReported\s*>\s*0\s*\?/,
    );
  });

  it("CANCELS THE SHEET'S OWN RENDER before tiling it", () => {
    // pdf.js serialises renders per PAGE, and `doc.getPage` returns the same
    // cached page the viewer is drawing with. A tile render started while the
    // sheet was still drawing queued behind it forever: the counter sat on
    // "0 of 15" for five minutes and NOT ONE request was sent, because the
    // loop never reached its first call.
    const handler = CODE.slice(CODE.indexOf("const onReadSheet"), CODE.indexOf("const onCheckRuns"));
    expect(handler.length, "the scan handler could not be located").toBeGreaterThan(500);
    const cancel = handler.indexOf("renderTaskRef.current?.cancel()");
    const render = handler.indexOf("page.render(");
    expect(cancel, "the viewer's in-flight render is never cancelled").toBeGreaterThan(-1);
    expect(render, "the handler no longer renders").toBeGreaterThan(-1);
    expect(cancel, "the cancel must come BEFORE the first tile render").toBeLessThan(render);
  });
});
