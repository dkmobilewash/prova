// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer, FoundWalls, ClusterMark } from "./TakeoffPlanViewer";
// THE PLAIN VALUES COME FROM A PLAIN MODULE, not from the viewer. Importing
// them from a `"use client"` file is what `lib/client-boundary.test.ts` fails
// the build over: across the RSC boundary they arrive as a client-reference
// proxy rather than the number or the function. The guard caught this the
// moment these cases were written, which is the whole reason it exists.
import { DISTINCT_MARKS, SHOWN_AT_FIRST, markFor } from "@/lib/takeoff/clusterMarks";
import { wallsOnThisSheet } from "@/lib/takeoff/wallGroups";
import { inchLabel, type WallCluster } from "@/lib/takeoff/wallVectors";
import { fitZoom, stepZoom } from "@/lib/takeoff-plan-view";
import type { PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * THE WALL FINDER'S CONTROL HAS TO BE ON THE SCREEN AN ESTIMATOR IS ON.
 *
 * A RENDER test, not a census, and #665 is why: that PR shipped a button gated
 * on a stage value, so it existed, called the right action, sat in the right
 * branch and appeared on no screen anybody used. Every assertion a source
 * census could make was true while the app was broken. A census proves the code
 * is THERE; only rendering proves somebody can reach it.
 *
 * What this does NOT cover is the detection itself — that needs a real PDF and
 * pdf.js, and it is measured in `wallVectors.test.ts` and against real drawings.
 * This covers the seam: the button appears when it can work, stays away when it
 * cannot, and the sheet is still usable either way.
 */

const sheet = (over: Partial<PlanSheet> = {}): PlanSheet =>
  ({
    id: "page_1",
    pageNumber: 1,
    label: "",
    pageWidthPt: 3024,
    calibration: {
      id: "cal_1",
      x1: 0.1,
      y1: 0.5,
      x2: 0.6,
      y2: 0.5,
      declaredDistanceFeet: 144,
      note: null,
    },
    measurements: [],
    zoneNotices: [],
    ...over,
  }) as unknown as PlanSheet;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(sheets: PlanSheet[]) {
  act(() => {
    root.render(
      createElement(TakeoffPlanViewer, {
        jobId: "job_1",
        planId: "plan_1",
        sheets,
        printedScaleByPage: {},
        scalePrefillByPage: {},
      } as never),
    );
  });
  return host;
}

describe("the wall finder's control", () => {
  it("is on the toolbar once the sheet is calibrated", () => {
    expect(paint([sheet()]).querySelector('[data-takeoff="find-walls"]')).not.toBeNull();
  });

  it("is SHOWN BUT DISABLED with no scale set — visible, not hidden", () => {
    // It shipped HIDDEN and was reported the same day: somebody opened a sheet,
    // went looking for the button they had been told about, and found nothing.
    // An absence reads as "this feature does not exist", never as "this sheet
    // needs a scale first".
    //
    // The gate itself is structural and unchanged — `wallVectors` asks "is this
    // thinner than 2-1/2in", so without a calibration there is no feet-per-unit
    // and every bound means nothing. What changed is that the reason is now on
    // screen instead of inferred from a blank space.
    const button = paint([sheet({ calibration: null } as Partial<PlanSheet>)]).querySelector(
      '[data-takeoff="find-walls"]',
    );
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("says WHY it is disabled, rather than leaving somebody to guess", () => {
    const button = paint([sheet({ calibration: null } as Partial<PlanSheet>)]).querySelector(
      '[data-takeoff="find-walls"]',
    );
    expect(button?.getAttribute("title")).toContain("Set the scale");
  });

  it("is enabled once the sheet has a scale", () => {
    const button = paint([sheet()]).querySelector('[data-takeoff="find-walls"]');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("says what it does in words an estimator reads, not a tool name", () => {
    const button = paint([sheet()]).querySelector('[data-takeoff="find-walls"]');
    expect(button?.textContent).toBe("Find the walls");
  });

  it("shows no results panel until it has been asked", () => {
    // A proposal arrives because somebody asked a question. Nothing is detected
    // on load — on the biggest sheet measured that would be a 1.7-second freeze
    // nobody requested.
    expect(paint([sheet()]).querySelector('[data-takeoff="found-walls"]')).toBeNull();
  });

  it("KEEPS THE CHECK BUTTON AWAY UNTIL THERE IS SOMETHING TO CHECK", () => {
    // "Check these are walls" asks a model what the found runs actually are —
    // countertops and bathtubs measure like walls and a real permit set
    // returned both. Before anything is found it can only refuse, so it is not
    // on the toolbar yet.
    expect(paint([sheet()]).querySelector('[data-takeoff="check-runs"]')).toBeNull();
  });

  it("A RENDER TEST, because the surface census cannot see this one", () => {
    // `aiSurfaceCensus` proves the FILE named for a feature contains a control.
    // This file contains a dozen, so pointing it at the viewer is satisfied by
    // any of them — the census would stay green with this button deleted, and
    // mutation showed exactly that.
    //
    // #665 is the precedent and the reason this suite exists at all: it shipped
    // a control gated on a stage value, which existed, called the right action,
    // sat in the right branch and appeared on no screen anybody used. A census
    // proves the code is THERE; only rendering proves somebody can reach it.
    //
    // The button lives behind `found !== null && found.length > 0`, which no
    // render here can reach without opening a PDF — so what this pins is the
    // condition itself, read off the source, beside the two render assertions
    // that prove the source is the one on screen.
    const source = readFileSync(
      resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source, "the check control is gone from the viewer").toContain(
      'data-takeoff="check-runs"',
    );
    expect(
      source,
      "the check control is no longer gated on there being runs to check",
    ).toMatch(/\{found !== null && found\.length > 0 && \( <button/);
    expect(source, "the control no longer calls the classifier").toContain("onClick={onCheckRuns}");
    // AND THE OTHER HALF OF THE ANSWER IS ON SCREEN. The check reports walls
    // the finder MISSED as well as runs that are not walls, and a wall nothing
    // paired is in no cluster and no total — so if this panel stops rendering,
    // the only thing in the app that can see an absent wall says nothing.
    expect(source, "the missing-walls panel is gone from the viewer").toContain(
      'data-takeoff="check-missing"',
    );
    expect(source, "the viewer no longer keeps what the check said was missing").toContain(
      "setMissed(result.value.missing)",
    );
    expect(source, "the classifier is no longer wired to the action").toContain(
      "await classifyWallCandidates(",
    );
  });

  it("rendered a real viewer, rather than passing against an empty page", () => {
    // The size assertion this family needs: every `toBeNull` above passes
    // vacuously against a component that threw and rendered nothing.
    const page = paint([sheet()]);
    expect(page.querySelector("canvas")).not.toBeNull();
    expect(page.textContent ?? "").toContain("Set scale");
  });
});

describe("naming a thickness the way a wall is sold", () => {
  it("rounds to the eighth an estimator recognises", () => {
    // The finder's own figure is an average over a group and carries decimals
    // no drawing ever had. `4.81"` states a precision the measurement does not
    // have; `4-3/4"` is a wall somebody can picture.
    expect(inchLabel(4.875)).toBe('4-7/8"');
    expect(inchLabel(4.81)).toBe('4-3/4"');
    expect(inchLabel(3.625)).toBe('3-5/8"');
    expect(inchLabel(6.125)).toBe('6-1/8"');
  });

  it("drops the fraction when there isn't one, and the whole when there is none", () => {
    expect(inchLabel(8)).toBe('8"');
    expect(inchLabel(12.02)).toBe('12"');
    expect(inchLabel(0.5)).toBe('1/2"');
  });

  it("never prints an unreduced fraction", () => {
    // 4/8 and 2/4 are the same wall and neither is how anybody writes it.
    for (let eighths = 1; eighths <= 160; eighths += 1) {
      expect(inchLabel(eighths / 8)).not.toMatch(/\b(2\/4|4\/8|6\/8|2\/8)"/);
    }
  });
});

/**
 * THE GHOST LINES, WHICH ARE THE SAFETY ARGUMENT AND WERE UNTESTABLE.
 *
 * Written inline in the viewer's SVG these could be made to render nothing and
 * the whole suite stayed green — measured, as a mutation, which is the only
 * reason anybody knew. The ghosts only exist after a real PDF has been read, so
 * no test could reach them there.
 *
 * It matters more than most rendering: an estimator accepts a group of walls on
 * the strength of SEEING them sit on real walls in the drawing. Ghosts that do
 * not draw turn an informed decision into a blind one, and nothing on screen
 * looks wrong.
 */
const cluster = (inches: number, runs: number): WallCluster => ({
  inches,
  feet: runs * 10,
  runs: Array.from({ length: runs }, (_, i) => ({
    x1: 0.1,
    y1: 0.1 + i * 0.01,
    x2: 0.5,
    y2: 0.1 + i * 0.01,
    thicknessFeet: inches / 12,
    lengthFeet: 10,
  })),
});

function svg(node: React.ReactElement) {
  const frame = document.createElement("div");
  document.body.append(frame);
  const r = createRoot(frame);
  act(() => r.render(createElement("svg", { viewBox: "0 0 1 1" }, node)));
  const html = frame.innerHTML;
  const lines = frame.querySelectorAll("line");
  act(() => r.unmount());
  frame.remove();
  return { html, lines };
}

describe("the ghost lines over the sheet", () => {
  it("draws one line per found run", () => {
    const { lines } = svg(createElement(FoundWalls, { clusters: [cluster(4.875, 7)], hovered: null }));
    expect(lines).toHaveLength(7);
  });

  it("draws every group, not just the first", () => {
    const { lines } = svg(
      createElement(FoundWalls, { clusters: [cluster(4.875, 3), cluster(6.125, 4)], hovered: null }),
    );
    expect(lines).toHaveLength(7);
  });

  it("puts each line where the wall is", () => {
    const { lines } = svg(createElement(FoundWalls, { clusters: [cluster(4.875, 1)], hovered: null }));
    expect(lines[0].getAttribute("x1")).toBe("0.1");
    expect(lines[0].getAttribute("x2")).toBe("0.5");
  });

  it("gives each group its own colour, so the panel and the drawing agree", () => {
    const { lines } = svg(
      createElement(FoundWalls, { clusters: [cluster(4.875, 1), cluster(6.125, 1)], hovered: null }),
    );
    expect(lines[0].getAttribute("stroke")).not.toBe(lines[1].getAttribute("stroke"));
  });

  it("fades the other groups when one is hovered", () => {
    const { lines } = svg(
      createElement(FoundWalls, { clusters: [cluster(4.875, 1), cluster(6.125, 1)], hovered: 0 }),
    );
    expect(lines[0].getAttribute("stroke-opacity")).toBe("1");
    expect(Number(lines[1].getAttribute("stroke-opacity"))).toBeLessThan(1);
  });

  it("is dashed, so a proposal never reads as something already counted", () => {
    const { lines } = svg(createElement(FoundWalls, { clusters: [cluster(4.875, 1)], hovered: null }));
    expect(lines[0].getAttribute("stroke-dasharray")).toBeTruthy();
    // Device pixels, not sheet units — a hairline at 50% zoom is invisible, and
    // `strokeWidth={0.002}` with this flag once shipped a line nobody could see.
    expect(lines[0].getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("IS ACTUALLY PLACED IN THE VIEWER'S SVG, not merely written and correct", () => {
    // Measured as a mutation: deleting `<FoundWalls .../>` from the viewer left
    // every test above green, because they render the component directly. A
    // component that works and is on no screen is exactly #665's defect, and
    // the pair of checks is what closes it — this one asks whether it is
    // placed, the ones above ask whether it draws. Neither implies the other.
    //
    // Source text, deliberately, because the ghosts cannot be reached through
    // the viewer without a real PDF. It is the weaker half of the pair and it
    // is the half nothing else can cover.
    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<FoundWalls\s+clusters=\{shownGroups\}\s+hovered=\{hovered\}\s*\/>/);
    // And that it sits inside the overlay rather than somewhere harmless.
    const overlay = code.slice(code.indexOf("<svg"), code.indexOf("</svg>"));
    expect(overlay).toContain("<FoundWalls");
    expect(overlay.length).toBeGreaterThan(200);
  });

  it("DRAWS ONLY WHAT THE PANEL LISTS, so no line is unattributable", () => {
    // ── THE DEFECT, FROM A REAL SHEET ──
    //
    // This was `clusters={found}` — every group — while the panel lists
    // `shownGroups`, which is `found.slice(0, SHOWN_AT_FIRST)`. A West Herr
    // floor plan clicked on production 2026-10-13 returned NINETEEN groups, so
    // seven of them had lines on the drawing and no row beside them. Worse,
    // the colour came from `index % 6`, so those seven wore the colours of
    // rows 1 to 6: a blue line could be row 1's wall, which an estimator can
    // accept, or row 13's, which they could not even see.
    //
    // The overlay is the verification channel for this whole feature —
    // `wallVectors.ts` returns centrelines precisely so a wrong answer is a
    // line where there is no wall. A line nobody can attribute breaks that.
    //
    // COMMENTS STRIPPED, and it is load-bearing: the comment at that call site
    // quotes `clusters={found}` in order to record what was wrong, so a
    // raw-text census would find the defect it is checking is gone.
    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    expect(code.length, "the viewer read as empty — this census guards nothing").toBeGreaterThan(10_000);
    expect(code, "the overlay is drawing groups the panel does not list").not.toMatch(
      /<FoundWalls\s+clusters=\{found\}/,
    );
    // And the list it follows is still the truncated one rather than having
    // been quietly widened to all of them, which would restore the defect from
    // the other end.
    expect(code).toMatch(/shownGroups\s*=\s*showingAll\s*\?\s*\(found \?\? \[\]\)\s*:\s*\(found \?\? \[\]\)\.slice\(0, SHOWN_AT_FIRST\)/);
  });

  // ── SIX COLOURS WERE LABELLING NINETEEN GROUPS ──
  //
  // On the West Herr sheet `index % 6` put groups 0, 6, 12 and 18 in the same
  // `#38bdf8`. The existing colour case above compares TWO groups and passes,
  // which is why nothing caught it: the collision needs the seventh.
  //
  // These assert the arithmetic at every index rather than at the two a render
  // test sets up by hand, which is the whole reason `markFor` was pulled out of
  // JSX. A decision inside JSX is a decision no test can reach.

  it("gives the first twelve groups — the panel's default — distinct marks", () => {
    const marks = Array.from({ length: SHOWN_AT_FIRST }, (_, i) => {
      const m = markFor(i, 2);
      return `${m.stroke}|${m.dash}`;
    });
    expect(new Set(marks).size, "two of the twelve listed groups share a mark").toBe(SHOWN_AT_FIRST);
  });

  it("separates the groups that used to collide, by name", () => {
    // The exact four from the sheet. Colour alone cannot tell them apart and
    // is not expected to — the dash is the rest of the mark.
    const blue = [0, 6, 12, 18].map((i) => markFor(i, 2));
    expect(new Set(blue.map((m) => m.stroke)).size, "all four are the same colour, as before").toBe(1);
    expect(new Set(blue.slice(0, 3).map((m) => m.dash)).size, "0, 6 and 12 must differ").toBe(3);
  });

  it("runs out at DISTINCT_MARKS and does not pretend otherwise", () => {
    // A finite palette cannot label an arbitrary number of groups. Claiming it
    // can is the failure the template filter's message was corrected for, so
    // the repeat is pinned as a known fact and the panel says it out loud.
    const all = Array.from({ length: DISTINCT_MARKS }, (_, i) => {
      const m = markFor(i, 2);
      return `${m.stroke}|${m.dash}`;
    });
    expect(new Set(all).size, "the marks are not all distinct below the limit").toBe(DISTINCT_MARKS);

    const first = markFor(0, 2);
    const wrapped = markFor(DISTINCT_MARKS, 2);
    expect(wrapped.stroke, "the cycle must wrap, not invent a colour").toBe(first.stroke);
    expect(wrapped.dash).toBe(first.dash);

    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the panel never tells anybody the marks repeat").toContain("repeat marks");
    // THE WHOLE GATE, not the condition on its own. Measured as a mutation:
    // replacing `showingAll` with `false` left both strings in the file and
    // this case green — the sentence was present and unreachable, which is the
    // same weakness the classifier fix was caught by hours earlier. A census
    // over a string proves the string exists; only the derivation proves
    // anybody can see it.
    expect(code, "the repeat warning is in the file but can never render").toMatch(
      /\{showingAll && found\.length > DISTINCT_MARKS && \(/,
    );
  });

  it("the PANEL and the DRAWING use the same mark for the same group", () => {
    // The disagreement this ends: a 12px coloured square in the panel beside a
    // drawing holding three different lines of that colour. Rendered on both
    // sides rather than asserted from the shared function, because "both call
    // markFor" is a claim about the source and this is a claim about pixels.
    //
    // COLOUR is compared and dash LENGTHS are not: the swatch is 16 CSS pixels
    // and the overlay is in page-width units, so the ratios match and the
    // absolute lengths deliberately do not — a dash scaled for the drawing is
    // one solid blob at swatch size.
    const groups = Array.from({ length: SHOWN_AT_FIRST }, (_, i) => cluster(4 + i / 8, 1));
    const { lines: drawn } = svg(createElement(FoundWalls, { clusters: groups, hovered: null }));
    expect(drawn).toHaveLength(SHOWN_AT_FIRST);

    for (let i = 0; i < SHOWN_AT_FIRST; i += 1) {
      const { lines: swatch } = svg(createElement(ClusterMark, { index: i }));
      expect(swatch, `no swatch rendered for group ${i}`).toHaveLength(1);
      expect(
        swatch[0].getAttribute("stroke"),
        `the panel and the drawing disagree about group ${i}`,
      ).toBe(drawn[i].getAttribute("stroke"));

      // The dash SHAPE: on-length over off-length, which is scale-free.
      const ratio = (value: string | null) => {
        const [on, off] = (value ?? "").split(" ").map(Number);
        return on / off;
      };
      expect(
        ratio(swatch[0].getAttribute("stroke-dasharray")),
        `group ${i}'s dash reads differently in the panel than on the sheet`,
      ).toBeCloseTo(ratio(drawn[i].getAttribute("stroke-dasharray")), 5);
    }
  });

  it("the viewer FILTERS to the building before grouping", () => {
    // Measured as a mutation: the viewer could stop calling `wallsInTheBuilding`
    // and every test above stayed green, because they exercise the function
    // directly. Without that call the title block, the notes column, the sheet
    // border and any detail above the plan all come back as walls — which is
    // what shipped, and what a person found by looking at the drawing.
    //
    // Source text, because the detect path needs a real PDF to reach. It is the
    // weaker half of a pair: the function's own behaviour is tested above, this
    // asks only whether anything calls it.
    // THE FILTERS MOVED. They were inline in this component until the pipeline
    // was lifted into `lib/takeoff/findWallsOnSheet.ts` so the bench and the
    // server could run the SAME ones — the bench's copy had drifted and was
    // inventing walls. The assertion is unchanged; the file that can contain
    // the answer is not.
    const viewer = readFileSync(resolve(process.cwd(), "lib/takeoff/findWallsOnSheet.ts"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/wallsInTheBuilding\(\s*everywhere\s*,\s*feetPerUnit\s*\)/);
    // And that what gets grouped is the FILTERED set, not the raw one.
    expect(code).toMatch(/clusterByThickness\(walls\)/);
    expect(code).not.toMatch(/clusterByThickness\(everywhere\)/);
  });

  it("the viewer drops LETTERING, and uses the filtered set", () => {
    // Measured as a mutation: the viewer could stop calling `wallsNotLettering`
    // and every test above stayed green, because they exercise the function
    // directly. Without it, dimension strings and room-number tags come back as
    // walls — 79 of 205 runs on a real sheet, in two whole groups.
    // THE FILTERS MOVED. They were inline in this component until the pipeline
    // was lifted into `lib/takeoff/findWallsOnSheet.ts` so the bench and the
    // server could run the SAME ones — the bench's copy had drifted and was
    // inventing walls. The assertion is unchanged; the file that can contain
    // the answer is not.
    const viewer = readFileSync(resolve(process.cwd(), "lib/takeoff/findWallsOnSheet.ts"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/wallsNotLettering\(\s*inBuilding\s*,\s*textBoxes\s*,\s*feetPerUnit\s*\)/);
    expect(code).toMatch(/clusterByThickness\(walls\)/);
    expect(code).not.toMatch(/clusterByThickness\(inBuilding\)/);
    // And that Fit is computed by the tested function rather than inline again.
    // THE VIEWER'S FILE, not the pipeline's: zoom is a thing the screen does,
    // and it stayed behind when the filters moved.
    expect(
      readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8"),
    ).toMatch(/fitZoom\(/);
  });

  it("the viewer SHOWS the decline reason, and only when it has nothing to offer", () => {
    // The reason was stored since #655 and rendered nowhere. A sheet that
    // offered a scale does not need to explain itself, so the message is gated
    // on there being no prefill — otherwise every successful sheet would carry
    // a note about something that did not matter.
    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/\{prefill === null && declineReason && \(/);
    expect(code).toMatch(/declineReason=\{scaleDeclineByPage\?\.\[pageNumber\] \?\? null\}/);
  });

  it("the viewer drops the SHEET BORDER, measured against the page's own height", () => {
    // Measured as a mutation: the viewer could stop calling this and the
    // function's own tests stayed green. A real permit set offered the left
    // border as a 114ft wall — one group, the longest run in the panel.
    //
    // The height argument is the ASPECT, not 1: the viewer's box has x running
    // 0..1 and y over that same width, so a landscape sheet's height is less
    // than 1. Passing 1 would compare a vertical border against the width and
    // let it straight through, which is the one mistake this filter exists to
    // avoid.
    // THE FILTERS MOVED. They were inline in this component until the pipeline
    // was lifted into `lib/takeoff/findWallsOnSheet.ts` so the bench and the
    // server could run the SAME ones — the bench's copy had drifted and was
    // inventing walls. The assertion is unchanged; the file that can contain
    // the answer is not.
    const viewer = readFileSync(resolve(process.cwd(), "lib/takeoff/findWallsOnSheet.ts"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // THE ASPECT IS NAMED NOW rather than spelled inline twice — the same
    // value, computed once where the pipeline also hands it to the detector.
    // The census still pins that the border is measured against the page's own
    // height and not against 1, which is the thing that was wrong.
    expect(code).toMatch(/const aspect = pageSize\.heightPt \/ pageSize\.widthPt;/);
    expect(code).toMatch(/wallsNotTheSheetBorder\(\s*notLettering\s*,\s*1\s*,\s*aspect\s*\)/);
    expect(code).toMatch(/clusterByThickness\(walls\)/);
    expect(code).not.toMatch(/clusterByThickness\(notLettering\)/);
  });

  it("the empty state says WHICH kind of empty, instead of blaming a scan", () => {
    // It read "a scanned or image-only sheet has no lines to read" on a drawing
    // made entirely of line work — a cause the app had never established. It
    // has just counted the strokes and knows which it is.
    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/\{strokesSeen === 0/);
    expect(code).toMatch(/setStrokesSeen\(segments\.length\)/);
    // The branch for a sheet that DOES have line work must not claim a scan.
    const branch = code.slice(code.indexOf("strokesSeen === 0"));
    const elseArm = branch.slice(branch.indexOf(": `"), branch.indexOf("`}"));
    expect(elseArm).not.toMatch(/scan/i);
    expect(elseArm).toMatch(/does have line work/);
  });

  it("draws nothing before anything has been found", () => {
    expect(svg(createElement(FoundWalls, { clusters: null, hovered: null })).lines).toHaveLength(0);
    expect(svg(createElement(FoundWalls, { clusters: [], hovered: null })).lines).toHaveLength(0);
  });
});

/**
 * A PROPOSAL BELONGS TO THE SHEET IT WAS READ OFF.
 *
 * Reported 2026-10-11 with three screenshots: Find the walls was pressed on a
 * floor plan, and the identical dashed overlay then appeared on sheet 30, on
 * sheet 52 and on S-101 — every run in the same place, on drawings it had
 * nothing to do with. Two of those are the partition-types sheet, whose own
 * scale is 3" = 1'-0", so the footage those lines implied was nonsense.
 *
 * `found` was page-less state that `onFindWalls` set and nothing cleared. The
 * comment above it said "switching sheets or reloading simply forgets them",
 * which was true of RELOADING and false of sheets for as long as the feature
 * had existed — the same shape CLAUDE.md records elsewhere, a sentence everyone
 * believed because it described what the code ought to do.
 *
 * THE REGRESSION THIS GUARDS IS THE WORST KIND THIS FEATURE CAN HAVE. The whole
 * posture is that a found wall is a proposal and the drawing underneath is the
 * check — the panel says "check they sit on real walls before adding them". An
 * overlay that follows somebody to another sheet does not just show a wrong
 * number, it corrupts the instrument they were told to verify with.
 */
describe("found walls stay on their own sheet", () => {
  const group = (): WallCluster & { runs: unknown[] } =>
    ({ inches: 4.875, feet: 100, runs: [{ feet: 100 }] }) as never;

  it("shows a result on the sheet it was found on", () => {
    expect(wallsOnThisSheet([group()] as never, 7, 7)).toHaveLength(1);
  });

  it("SHOWS NOTHING ON ANY OTHER SHEET — the defect as reported", () => {
    // Found on sheet 1, paged to the partition-types sheet.
    expect(wallsOnThisSheet([group()] as never, 1, 30)).toBeNull();
    expect(wallsOnThisSheet([group()] as never, 1, 52)).toBeNull();
    // And the neighbouring sheet, because off-by-one is the likely regression.
    expect(wallsOnThisSheet([group()] as never, 1, 2)).toBeNull();
  });

  it("shows nothing when nothing has been found, on any sheet", () => {
    expect(wallsOnThisSheet(null, null, 1)).toBeNull();
    expect(wallsOnThisSheet(null, 1, 1)).toBeNull();
  });

  it("restores the result when you page back, rather than demanding another press", () => {
    const groups = [group()] as never;
    expect(wallsOnThisSheet(groups, 3, 4)).toBeNull();
    expect(wallsOnThisSheet(groups, 3, 3)).toHaveLength(1);
  });

  it("IS WHAT THE VIEWER ACTUALLY RENDERS FROM, not merely written and correct", () => {
    // The #665 lesson, and the reason this case exists next to the pure ones: a
    // rule nothing calls is a rule the app does not have. Both the panel and the
    // overlay must read the derived value, and the page must be recorded WITH
    // the result rather than at render time.
    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the viewer never narrows the result to the sheet").toMatch(
      /const found = wallsOnThisSheet\(foundRaw, foundOnPage, pageNumber\)/,
    );
    expect(code, "nothing records which sheet the result came from").toMatch(
      /setFoundOnPage\(pageNumber\)/,
    );
    // ── THE RAW STATE MUST NOT REACH A RENDER SITE ──
    //
    // THIS ASSERTION USED TO BE A COUNT — `foundRaw` exactly twice, its own
    // declaration and the derivation — and the count was the wrong instrument.
    // It broke the day a legitimate NON-render read was added (an effect that
    // seeds the state from stored proposals reads it in a guard and in its
    // dependency list), which took it to four and failed a viewer that was
    // correct.
    //
    // The temptation then is to change the 2 to a 4, which turns the guard into
    // "however many there happen to be" and is this repo's own lesson about a
    // check that cannot say what it means. So it now asserts WHERE rather than
    // HOW MANY, which is both stronger and stable: a render site is inside the
    // component's returned JSX, and the raw state has no business there.
    // ── LOCATED FROM THE COMPONENT, NOT FROM THE FIRST `return (` IN THE FILE ──
    //
    // This was `code.indexOf("\n  return (")` and a MODULE-SCOPE HELPER broke
    // it: any top-level function whose body returns a parenthesised expression
    // at two spaces of indent sits earlier in the file, so the split landed
    // above it and every assertion below was then made about the wrong half.
    // The failure message it printed — "the viewer never narrows the result to
    // the sheet" — pointed at a line that was present and correct two hundred
    // lines further down.
    //
    // Its own next line already said to fix this rather than trust it. Anchored
    // on the component now, so a helper added above it cannot move the split.
    const componentAt = code.indexOf("export function TakeoffPlanViewer(");
    expect(componentAt, "the component's declaration could not be found").toBeGreaterThan(0);
    const jsxAt = code.indexOf("\n  return (", componentAt);
    expect(jsxAt, "the component's JSX could not be located — fix this before trusting it").toBeGreaterThan(0);

    const render = code.slice(jsxAt);
    // The derivation must be ABOVE the JSX, so this cannot pass by the whole
    // file landing on the wrong side of the split.
    expect(code.slice(0, jsxAt)).toContain("const found = wallsOnThisSheet(");
    expect(
      render.match(/foundRaw/g) ?? [],
      "the raw found-walls state is read in the viewer's JSX, around the per-sheet guard",
    ).toHaveLength(0);
    // And `found` IS read there, so a render region that simply shows no walls
    // at all cannot satisfy the line above.
    expect(render).toMatch(/\bfound\b/);
  });
});

/**
 * SEEING THE WHOLE SHEET, which was not possible at any zoom.
 *
 * `ZOOM_STEPS` multiply `BASE_SCALE` of 1.5, so the old floor of 0.5 rendered
 * at 0.75 of full size: a 42-inch ARCH E sheet is 3,024pt, which is ~2,270 CSS
 * px — wider than the viewport. The control read "50%" and the drawing still
 * ran off the edge, with nothing further out to press. Reported from a real
 * plan set: "cuts off most of the plans even when you zoom all the way out".
 *
 * Steps alone cannot fix it, because the right zoom for a whole sheet depends
 * on the sheet AND the window, so no fixed list contains it. Hence FIT.
 */
describe("stepping the zoom", () => {
  it("steps DOWN from whatever is on screen, including a fitted sheet", () => {
    // The case that makes this take a factor rather than an index: a fitted
    // 42-inch sheet sits around 0.3, and pressing − must find 0.25 rather than
    // jumping to whichever index was last selected.
    expect(stepZoom(0.3, -1)).toBe(0.25);
    expect(stepZoom(0.3, 1)).toBe(0.33);
  });

  it("goes further out than the old floor, which is the whole point", () => {
    expect(stepZoom(0.5, -1)).toBeLessThan(0.5);
    expect(stepZoom(0.25, -1)).toBeLessThan(0.25);
  });

  it("NEVER ZOOMS IN WHEN ASKED TO ZOOM OUT", () => {
    // The shipped bug, reported the hour it went live: a fitted 42-inch sheet
    // in a narrow window sits at 11%, below the 15% floor, and `−` returned
    // ZOOM_STEPS[0] — 15%, which is BIGGER — then greyed the control out.
    // Fit is a computed scale and can legitimately be below every step.
    expect(stepZoom(0.11, -1)).toBeLessThanOrEqual(0.11);
    expect(stepZoom(0.05, -1)).toBeLessThanOrEqual(0.05);
    expect(stepZoom(0.14, -1)).toBeLessThanOrEqual(0.14);
  });

  it("never zooms OUT when asked to zoom in", () => {
    expect(stepZoom(99, 1)).toBeGreaterThanOrEqual(99);
    expect(stepZoom(8, 1)).toBeGreaterThanOrEqual(8);
  });

  it("never returns the value it was given, or a step would do nothing", () => {
    for (const from of [0.15, 0.25, 0.5, 1, 2, 8, 0.3, 0.42]) {
      if (from > 0.15) expect(stepZoom(from, -1)).not.toBe(from);
      if (from < 8) expect(stepZoom(from, 1)).not.toBe(from);
    }
  });
});

describe("what Fit computes", () => {
  it("FITS BOTH DIMENSIONS, not just width", () => {
    // The shipped bug, reported within the hour: in a wide, short window Fit
    // matched the sheet's WIDTH and left the top half cut off — labelled "Fit"
    // the whole time. A 42x30 sheet in a 1400x400 box is bound by height.
    const z = fitZoom({ width: 1400, height: 400 }, { widthPt: 3024, heightPt: 2160 }, 1.5);
    expect(z * 2160 * 1.5).toBeLessThanOrEqual(400);
  });

  it("is bound by width when width is the tighter of the two", () => {
    const z = fitZoom({ width: 600, height: 4000 }, { widthPt: 3024, heightPt: 2160 }, 1.5);
    expect(z * 3024 * 1.5).toBeLessThanOrEqual(600);
  });

  it("never returns zero, which would make the sheet vanish", () => {
    expect(fitZoom({ width: 10, height: 10 }, { widthPt: 3024, heightPt: 2160 }, 1.5)).toBeGreaterThan(0);
  });

  it("falls back rather than dividing by nothing", () => {
    expect(fitZoom({ width: 0, height: 0 }, { widthPt: 3024, heightPt: 2160 }, 1.5)).toBe(1);
    expect(fitZoom({ width: 800, height: 600 }, { widthPt: 0, heightPt: 0 }, 1.5)).toBe(1);
  });
});

describe("the Fit control", () => {
  it("is on the toolbar", () => {
    expect(paint([sheet()]).querySelector('[data-takeoff="fit"]')).not.toBeNull();
  });

  it("is the state a sheet opens in", () => {
    // A drawing should show all of itself before somebody zooms IN to measure.
    // Opening at a fixed percentage is what produced the original complaint.
    const fit = paint([sheet()]).querySelector('[data-takeoff="fit"]');
    expect(fit?.className).toContain("tag-amber-ink");
  });
});

describe("the sheet and the found walls share a row", () => {
  /**
   * WHAT THIS CAN AND CANNOT PROVE.
   *
   * It cannot see layout. happy-dom does no layout and returns zeros from
   * getBoundingClientRect, which is why every number in the commit that added
   * this came from real Chromium instead: at 1512px the drawing's fit zoom goes
   * from 25% to 34%, because the frame stops being 1480x548 — aspect 2.7
   * against a sheet of aspect 1.4 — and becomes 1100x724.
   *
   * What it CAN prove is the structure those numbers depend on: that the panel
   * and the sheet are SIBLINGS in one container rather than stacked in the
   * page. Un-nest them and the measurement above stops describing the app,
   * silently, because nothing else in this repo would notice.
   */
  it("puts the found panel and the plan port in the SAME parent", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(TakeoffPlanViewer, {
          jobId: "job_1",
          sheets: [sheet()],
          canEdit: true,
        } as never),
      );
    });
    const port = host.querySelector('[data-testid="takeoff-plan-port"]');
    expect(port, "the plan port must render").not.toBeNull();
    // The row exists whether or not walls have been found — the sheet lives in
    // it either way, so the panel has somewhere to arrive.
    const row = port?.parentElement;
    expect(row, "the plan port must sit inside a row container").not.toBeNull();
    expect(row?.className ?? "").toContain("flex-row-reverse");
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("the caution on a sheet that would double-count", () => {
  /**
   * A RENDER test and not a census, for the reason this file's header gives:
   * #665 shipped a control that existed, sat in the right branch, called the
   * right action and appeared on no screen anybody used.
   *
   * What it guards: scored against a 60-page answer key, mechanical plans,
   * reflected ceiling plans and elevations invented 13,767 ft between them — a
   * third of everything the wall finder reported across the set. The classifier
   * catches those sheets and this caution is how an estimator finds out.
   */
  it("stays away until something has actually been found", async () => {
    // The caution belongs TO the found walls. With nothing found there is
    // nothing to caution about, and a warning on an untouched sheet is noise.
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(TakeoffPlanViewer, {
          jobId: "job_1",
          sheets: [sheet()],
          canEdit: true,
          duplicateWallsByPage: { 1: "M-101 is a mechanical plan. Adding it would bid those walls twice." },
        } as never),
      );
    });
    expect(host.querySelector('[data-takeoff="duplicate-walls-caution"]')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("says nothing on a page with no caution for it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(TakeoffPlanViewer, {
          jobId: "job_1",
          sheets: [sheet()],
          canEdit: true,
          duplicateWallsByPage: {},
        } as never),
      );
    });
    expect(host.querySelector('[data-takeoff="duplicate-walls-caution"]')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("ACCEPTS THE PROP BEING ABSENT, so every existing caller still renders", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(TakeoffPlanViewer, { jobId: "job_1", sheets: [sheet()], canEdit: true } as never),
      );
    });
    expect(host.querySelector('[data-testid="takeoff-plan-port"]')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});
