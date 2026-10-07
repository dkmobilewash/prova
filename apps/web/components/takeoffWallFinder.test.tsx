// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoffPlanViewer, FoundWalls } from "./TakeoffPlanViewer";
import { inchLabel, type WallCluster } from "@/lib/takeoff/wallVectors";
import { stepZoom } from "@/lib/takeoff-plan-view";
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
    expect(code).toMatch(/<FoundWalls\s+clusters=\{found\}\s+hovered=\{hovered\}\s*\/>/);
    // And that it sits inside the overlay rather than somewhere harmless.
    const overlay = code.slice(code.indexOf("<svg"), code.indexOf("</svg>"));
    expect(overlay).toContain("<FoundWalls");
    expect(overlay.length).toBeGreaterThan(200);
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
    const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/wallsInTheBuilding\(\s*everywhere\s*,\s*feetPerUnit\s*\)/);
    // And that what gets grouped is the FILTERED set, not the raw one.
    expect(code).toMatch(/clusterByThickness\(walls\)/);
    expect(code).not.toMatch(/clusterByThickness\(everywhere\)/);
  });

  it("draws nothing before anything has been found", () => {
    expect(svg(createElement(FoundWalls, { clusters: null, hovered: null })).lines).toHaveLength(0);
    expect(svg(createElement(FoundWalls, { clusters: [], hovered: null })).lines).toHaveLength(0);
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

  it("stops at the ends instead of running off them", () => {
    expect(stepZoom(0.01, -1)).toBeGreaterThan(0);
    expect(stepZoom(99, 1)).toBeLessThanOrEqual(8);
    expect(stepZoom(99, 1)).toBeGreaterThan(0);
  });

  it("never returns the value it was given, or a step would do nothing", () => {
    for (const from of [0.15, 0.25, 0.5, 1, 2, 8, 0.3, 0.42]) {
      if (from > 0.15) expect(stepZoom(from, -1)).not.toBe(from);
      if (from < 8) expect(stepZoom(from, 1)).not.toBe(from);
    }
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
