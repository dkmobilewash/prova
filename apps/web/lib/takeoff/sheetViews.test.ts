import { describe, expect, it } from "vitest";
import {
  excludedViews,
  insideView,
  primaryView,
  sheetViews,
  type SheetView,
  type ViewWalls,
  viewBoxes,
  viewRegions,
  viewsInRegions,
  wallsPerView,
  withDimensionScale,
} from "./sheetViews";

/**
 * Positions are in POINTS on a 2592pt sheet, which is the real S15 geometry —
 * every number below was read off that fixture rather than invented, so a
 * distance that matters here is a distance that matters on a drawing.
 */
const W = 2592;
const at = (str: string, xPct: number, yPct: number) => ({
  str,
  x: (xPct / 100) * W,
  y: (yPct / 100) * W,
});

/** S15's own text, trimmed to what decides the answer. */
const S15 = [
  at("FLOOR PLAN", 5.0, 63.7),
  at('SCALE: 1/4" = 1\'-0"', 5.0, 64.2),
  at("ENLARGED BATH PLAN", 52.6, 63.7),
  at('SCALE: 1/2" = 1\'-0"', 52.6, 64.2),
  at("DATE: 10/15/2026", 92.7, 60.9),
  at('SCALE: 1/4" = 1\'-0"', 92.7, 61.4),
  at("BUNGALOW - PLAN AND ENLARGED", 92.7, 4.6),
  at("PLAN S15", 92.7, 5.2),
];

describe("splitting a sheet into its views", () => {
  it("FINDS BOTH DRAWINGS AND NEITHER MORE", () => {
    const views = sheetViews(S15, W);
    expect(views.map((v) => v.name)).toEqual(["FLOOR PLAN", "ENLARGED BATH PLAN"]);
    expect(views.map((v) => v.scaleName)).toEqual(['1/4" = 1\'-0"', '1/2" = 1\'-0"']);
  });

  it("FINDS A CAPTION WRITTEN IN THE SHORT FORM — `ELEV.`, not `ELEVATION`", () => {
    // ── THE ONE WORD THAT COST A WHOLE SHEET ──
    //
    // Camp Bow Wow A120 captions all eight of its interior elevations
    // `RR 105 - EAST ELEV.`, and this pattern knew only the full word. So nine
    // drawings read as ONE view, the viewer only splits a sheet with two or
    // more, and the enlarged plan's region grew to cover the whole page — the
    // elevations, the accessories schedule and the floor hatching all measured
    // as wall, 542 ft of it.
    //
    // FINDING a view and deciding what KIND it is are two steps, and this is
    // the first: a drawing that is never found owns no part of the page, so
    // its geometry is adopted by whatever caption is nearest. It has to be
    // found in order to be excluded.
    const captions = [
      { str: "RR 105 - EAST ELEV.", x: 0.14 * W, y: 0.425 * W },
      { str: '3/8" = 1\'-0"', x: 0.16 * W, y: 0.431 * W },
      { str: "RESTROOM - ENLARGED PLAN", x: 0.14 * W, y: 0.216 * W },
      { str: '1/2" = 1\'-0"', x: 0.16 * W, y: 0.222 * W },
    ];
    const views = sheetViews(captions, W);
    expect(views.map((v) => v.name).sort()).toEqual([
      "RESTROOM - ENLARGED PLAN",
      "RR 105 - EAST ELEV.",
    ]);
    const elevation = views.find((v) => v.name.includes("ELEV."));
    expect(elevation?.scaleName, "the short-form caption got no scale").toBe('3/8" = 1\'-0"');
  });

  it("does not read ELEVATOR as an elevation", () => {
    // `\bELEV\b` cannot match ELEVATOR — there is no word boundary before the
    // R — so an elevator lobby plan is still a plan. Written down because the
    // abbreviation above is the kind of pattern that eats a real word.
    const captions = [
      { str: "ELEVATOR LOBBY PLAN", x: 0.14 * W, y: 0.425 * W },
      { str: '1/4" = 1\'-0"', x: 0.16 * W, y: 0.431 * W },
    ];
    const views = sheetViews(captions, W);
    expect(views).toHaveLength(1);
    expect(excludedViews(views), "an elevator lobby plan was left out").toEqual([]);
  });

  it("LEAVES THE TITLE BLOCK OUT, which is the trap that beat the first rule", () => {
    // Every sheet prints a scale in its title block, so a count of scales
    // cannot separate them. The rule that looked right — "a view caption has
    // text directly above it" — is FALSE here: `DATE: 10/15/2026` sits 0.5%
    // above the title block's scale, the same gap as a real caption. What
    // separates them is that a view is captioned with WHAT IT IS.
    const views = sheetViews(S15, W);
    expect(views, "the title block's scale was read as a third drawing").toHaveLength(2);
    expect(views.some((v) => v.captionX > 0.9)).toBe(false);
  });

  it("is not fooled by the SHEET'S OWN TITLE containing the word PLAN", () => {
    // "BUNGALOW - PLAN AND ENLARGED" matches the view-name pattern and is a
    // title, not a caption. It is excluded by distance — 56% of the page from
    // any scale — so this asserts the distance rule is doing work.
    const views = sheetViews([at("BUNGALOW - PLAN AND ENLARGED", 92.7, 4.6), at('1/4" = 1\'-0"', 92.7, 61.4)], W);
    expect(views).toEqual([]);
  });

  it("CLAIMS THE WHOLE PAGE UNTIL THE GUTTERS ARE READ, so a caller that skips them measures the sheet as before", () => {
    // `sheetViews` sees only text, and a region is a fact about GEOMETRY.
    // Returning the whole page rather than a guess is what makes
    // `viewsInRegions` an addition instead of a behaviour change.
    for (const view of sheetViews(S15, W)) {
      expect(view.from).toBe(0);
      expect(view.to).toBe(1);
      expect(view.fromY).toBe(0);
    }
  });

  it("SAYS NOTHING on a sheet with no captioned view", () => {
    // S10, S12, S16, S17 and the three scans are all like this. Returning
    // nothing is what keeps 19 of the 20 fixtures on exactly the path they
    // were on before any of this existed.
    expect(sheetViews([at("SOME NOTE", 10, 10), at("1 = 2", 10, 11)], W)).toEqual([]);
    expect(sheetViews([], W)).toEqual([]);
    expect(sheetViews(S15, 0)).toEqual([]);
  });
});

describe("whose scale a view is measured at", () => {
  const views: SheetView[] = [
    { name: "A", scaleName: '1/8" = 1\'-0"', feetPerInch: 8, captionX: 0.05, captionY: 0.6, from: 0.05, to: 0.5, fromY: 0, toY: 1 },
    { name: "B", scaleName: '1/2" = 1\'-0"', feetPerInch: 2, captionX: 0.5, captionY: 0.6, from: 0.5, to: 1, fromY: 0, toY: 1 },
  ];

  it("THE MEASURED SCALE REPLACES THE CAPTION, for the view it was measured in", () => {
    // S11 is why: its caption says 1/8in and its own dimensions say 1/4in, and
    // believing the caption costs 13 ft. A dimension can be checked against
    // the drawing; a caption cannot.
    const fixed = withDimensionScale(views, { feetPerInch: 4, scaleName: '1/4" = 1\'-0"', atX: 0.2 });
    expect(fixed[0].feetPerInch).toBe(4);
    expect(fixed[0].scaleName).toBe('1/4" = 1\'-0"');
  });

  it("AND LEAVES EVERY OTHER VIEW ALONE, because a detail is at another scale BY DEFINITION", () => {
    // Applying the plan's measured scale to the detail beside it would put
    // back the exact defect this file exists to remove.
    const fixed = withDimensionScale(views, { feetPerInch: 4, scaleName: '1/4" = 1\'-0"', atX: 0.2 });
    expect(fixed[1].feetPerInch).toBe(2);
    expect(fixed[1].scaleName).toBe('1/2" = 1\'-0"');
  });

  it("changes nothing when the measured line sits in no view's band", () => {
    const fixed = withDimensionScale(views, { feetPerInch: 4, scaleName: '1/4" = 1\'-0"', atX: 0.01 });
    expect(fixed.map((v) => v.feetPerInch)).toEqual([8, 2]);
  });
});

describe("which view a takeoff quotes", () => {
  const made = (name: string, lengthFeet: number) =>
    ({ view: { name } as SheetView, found: {} as never, walls: [], lengthFeet }) as ViewWalls;

  it("QUOTES THE BIGGEST BY FOOTAGE, not the smallest scale and not the first", () => {
    // "The smallest scale is the overall plan" is usually true and is not a
    // rule — a key plan is small-scale and is not the thing to bid.
    const { primary, others } = primaryView([made("detail", 28), made("plan", 167), made("key", 4)]);
    expect(primary?.view.name).toBe("plan");
    expect(others.map((o) => o.view.name)).toEqual(["detail", "key"]);
  });

  it("DOES NOT SUM ACROSS VIEWS, which would bid the same bathroom twice", () => {
    const { primary, others } = primaryView([made("plan", 167), made("detail", 28)]);
    expect(primary?.lengthFeet).toBe(167);
    expect(others).toHaveLength(1);
  });

  it("returns nothing for nothing rather than throwing", () => {
    expect(primaryView([])).toEqual({ primary: null, others: [] });
  });
});

/**
 * ── A-401, THE ONLY MULTI-VIEW SHEET IN THE REPO WITH GROUND TRUTH ──
 *
 * Positions are its own, converted to the same 2592pt page. It is the sheet
 * that broke two rules this file previously asserted, so every case below
 * exists because something shipped wrong first.
 */
const A401 = [
  at("ENLARGED RESTROOM PLAN", 8, 51),
  at('SCALE: 1/4" = 1\'-0"', 8, 51.6),
  at("ENLARGED STAIR PLAN", 44, 61),
  at('SCALE: 1/2" = 1\'-0"', 44, 61.6),
  at("HEAD OF WALL DETAIL", 75, 33),
  at("SCALE: NTS", 75, 34),
];

describe("a drawing with no scale to read", () => {
  it("IS STILL A VIEW, and that is the whole point of it", () => {
    // A-401 carries a HEAD OF WALL DETAIL captioned NTS. Read as "no caption
    // here", its region was absorbed by the drawing beside it and measured at
    // THAT drawing's scale — and a wall detail is a cross-section, parallel
    // lines a wall-thickness apart for its whole height. It added 64 ft of
    // "wall" to the stair plan that is not a building.
    const views = sheetViews(A401, W);
    expect(views.map((v) => v.name)).toContain("HEAD OF WALL DETAIL");
  });

  it("CARRIES NO SCALE, so nothing can measure it", () => {
    const detail = sheetViews(A401, W).find((v) => v.name === "HEAD OF WALL DETAIL");
    expect(detail?.feetPerInch).toBeNull();
    expect(detail?.scaleName).toBeNull();
  });

  it("does not stop the two real views being read at their own scales", () => {
    const views = sheetViews(A401, W);
    const byName = Object.fromEntries(views.map((v) => [v.name, v.scaleName]));
    expect(byName["ENLARGED RESTROOM PLAN"]).toBe('1/4" = 1\'-0"');
    expect(byName["ENLARGED STAIR PLAN"]).toBe('1/2" = 1\'-0"');
  });

  it("is NOT invented for a name with nothing under it at all", () => {
    // "SCALE: NTS" is a caption that cannot be read. A view name with no scale
    // line beneath it is a label, a legend entry or a note — not a drawing.
    expect(sheetViews([at("ENLARGED STAIR PLAN", 44, 61)], W)).toEqual([]);
    expect(sheetViews([at("SEE PLAN FOR DETAIL", 10, 10)], W)).toEqual([]);
  });
});

describe("the regions a sheet is cut into", () => {
  const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
  const page = { widthPt: 1000, heightPt: 1000 };

  it("CUTS ON EMPTY PAPER, both across the page and down it", () => {
    // Two drawings stacked, with a 100pt gutter between them — well over the
    // half inch (36pt) a gutter has to be. The x axis has no gap at all, so
    // this can only be separated on y, which is the case the first version of
    // this file could not see.
    const stacked = [
      seg(100, 100, 400, 100),
      seg(100, 100, 100, 200),
      seg(100, 400, 400, 400),
      seg(100, 400, 100, 500),
    ];
    const regions = viewRegions(stacked, page);
    expect(regions.length, "a stacked sheet was not separated").toBeGreaterThan(1);
    expect(regions.every((r) => r.from === 0 && r.to === 1), "it cut on x, where there is no gap").toBe(true);
  });

  it("does NOT cut a single drawing into pieces at a room's interior", () => {
    // A room is void, and a naive gap finder would cut through it. It cannot:
    // the walls above and below the room occupy the same x, so the only empty
    // columns are outside the building.
    const oneRoom = [
      seg(100, 100, 400, 100),
      seg(100, 400, 400, 400),
      seg(100, 100, 100, 400),
      seg(400, 100, 400, 400),
    ];
    expect(viewRegions(oneRoom, page)).toHaveLength(1);
  });

  it("IGNORES THE FRAME, which otherwise bridges every gutter on the page", () => {
    // A border rule runs the full width of the sheet. Counted as geometry it
    // fills every column and every row, and a page with two drawings comes
    // back as one region with nothing to say why.
    const twoPlusFrame = [
      seg(100, 100, 300, 100),
      seg(700, 100, 900, 100),
      seg(10, 10, 990, 10),
      seg(10, 10, 10, 990),
    ];
    expect(viewRegions(twoPlusFrame, page).length).toBeGreaterThan(1);
  });

  it("DOES NOT CUT ON A GAP TOO NARROW TO BE A GUTTER", () => {
    // The room test above passes with ANY threshold, because a room's walls
    // leave no gap in the projection at all — so it says nothing about the
    // half inch. This does: a 20pt gap is real, and it is narrower than the
    // 36pt a gutter has to be, so the two pieces stay one drawing.
    const near = [seg(100, 100, 300, 100), seg(320, 100, 500, 100)];
    expect(viewRegions(near, page), "a 20pt gap was treated as a gutter").toHaveLength(1);
    // And the same geometry 100pt apart IS two.
    const far = [seg(100, 100, 300, 100), seg(400, 100, 600, 100)];
    expect(viewRegions(far, page).length).toBeGreaterThan(1);
  });

  it("returns nothing for nothing", () => {
    expect(viewRegions([], page)).toEqual([]);
    expect(viewRegions([seg(1, 1, 2, 2)], { widthPt: 0, heightPt: 0 })).toEqual([]);
  });
});

describe("which region each view gets", () => {
  const r = (from: number, to: number) => ({ from, to, fromY: 0, toY: 1 });
  const cap = (name: string, x: number): SheetView => ({
    name, scaleName: '1/4" = 1\'-0"', feetPerInch: 4, captionX: x, captionY: 0.6,
    from: 0, to: 1, fromY: 0, toY: 1,
  });

  it("MERGES A STRIP THAT HAS NO CAPTION into the nearest view that has one", () => {
    // S05 and S07 went to ZERO FEET on the first version, which ran the other
    // way round. A plan's dimension column sits to its left with empty paper
    // between, and that gap is a gutter by every test. The caption, at the
    // left margin, chose the strip — and the building was outside the only
    // region anybody measured.
    const got = viewsInRegions([cap("FLOOR PLAN", 0.06)], [r(0, 0.1), r(0.1, 0.9)]);
    expect(got[0].from).toBe(0);
    expect(got[0].to).toBe(0.9);
  });

  it("keeps two captioned drawings apart", () => {
    const got = viewsInRegions([cap("PLAN", 0.1), cap("DETAIL", 0.7)], [r(0, 0.4), r(0.6, 1)]);
    expect(got[0].to).toBe(0.4);
    expect(got[1].from).toBe(0.6);
  });

  it("leaves a view alone when there are no regions to give it", () => {
    const got = viewsInRegions([cap("FLOOR PLAN", 0.1)], []);
    expect(got[0].from).toBe(0);
    expect(got[0].to).toBe(1);
  });

  /**
   * ── A SHEET THAT STACKS ITS DRAWINGS WITH NO GUTTER BETWEEN THEM ──
   *
   * Camp Bow Wow A120's shape, which is why these exist. Nine drawings, and
   * `viewRegions` found four regions every one of which spanned the whole page
   * height, because a gutter is half an inch of empty paper across the other
   * axis and the elevation rows are packed. A region then held three captions,
   * the first took all three drawings, and the other two were handed
   * `from: 0, to: 1` — the whole sheet.
   */
  const stacked = (name: string, x: number, y: number): SheetView => ({
    name, scaleName: '1/4" = 1\'-0"', feetPerInch: 4, captionX: x, captionY: y,
    from: 0, to: 1, fromY: 0, toY: Number.POSITIVE_INFINITY,
  });

  it("SHARES ONE REGION OUT between the captions inside it", () => {
    const got = viewsInRegions(
      [stacked("FLOOR PLAN", 0.2, 0.2), stacked("EAST ELEV.", 0.2, 0.6)],
      [{ from: 0, to: 1, fromY: 0, toY: 1 }],
    );
    // Cut at the midpoint between the two captions, each keeping its own side.
    expect(got[0].toY).toBeCloseTo(0.4, 5);
    expect(got[1].fromY).toBeCloseTo(0.4, 5);
    expect(got[0].fromY).toBe(0);
    expect(got[1].toY).toBe(1);
  });

  it("cuts BOTH axes, so a drawing in a second column still gets a region", () => {
    // Cutting only the axis the captions were most spread on left three of
    // A120's elevations with an EMPTY box: both captions in a row-slice were
    // equidistant from it, so the first took it.
    const got = viewsInRegions(
      [
        stacked("FLOOR PLAN", 0.2, 0.2),
        stacked("EAST ELEV.", 0.2, 0.6),
        stacked("SOUTH ELEV.", 0.7, 0.6),
      ],
      [{ from: 0, to: 1, fromY: 0, toY: 1 }],
    );
    for (const one of got) {
      expect(one.to - one.from, `${one.name} got no width`).toBeGreaterThan(0);
      expect(one.toY - one.fromY, `${one.name} got no height`).toBeGreaterThan(0);
    }
    expect(got[2].from).toBeCloseTo(0.45, 5);
  });

  it("gives a caption that won nothing an EMPTY box, never the sheet", () => {
    // Two captions at the same point: one must lose. Losing used to mean
    // keeping `from: 0, to: 1` — every stroke on the page, measured at this
    // caption's own scale.
    const got = viewsInRegions(
      [stacked("FLOOR PLAN", 0.2, 0.2), stacked("ALSO HERE PLAN", 0.2, 0.2)],
      [{ from: 0, to: 1, fromY: 0, toY: 1 }],
    );
    const loser = got[1];
    expect(loser.to - loser.from).toBe(0);
    expect(loser.toY - loser.fromY).toBe(0);
  });

  it("owns its boxes rather than the box AROUND them", () => {
    // The plan owns a full-height strip down the left AND a slice at the top.
    // The bounding box of those two covers what is stacked below it, which is
    // another drawing — so `insideView` asks the boxes, not the range.
    const got = viewsInRegions(
      [stacked("FLOOR PLAN", 0.3, 0.2), stacked("EAST ELEV.", 0.3, 0.8)],
      [
        { from: 0, to: 0.1, fromY: 0, toY: 1 },
        { from: 0.1, to: 1, fromY: 0, toY: 1 },
      ],
    );
    const plan = got[0];
    expect(viewBoxes(plan).length).toBeGreaterThan(1);
    // Inside the bounding box, but down in the elevation's half of the sheet.
    expect(plan.fromY).toBe(0);
    expect(plan.toY).toBe(1);
    expect(insideView(plan, 0.5, 0.9)).toBe(false);
    expect(insideView(plan, 0.5, 0.1)).toBe(true);
    // The strip with no caption of its own still belongs to the plan.
    expect(insideView(plan, 0.05, 0.9)).toBe(true);
  });
});

describe("what gets measured", () => {
  const seg2 = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
  const page = { widthPt: 1000, heightPt: 1000 };

  /** A plain two-face wall, long enough and thick enough to be found.
   *  8pt apart on a 1000pt page at 40 ft per page width is 3.8in — inside the
   *  thickness band. 4pt is 1.9in and is BELOW it, which is what the first
   *  version of this used, and the control it broke said so. */
  const wallAt = (x: number) => [
    seg2(x, 100, x + 300, 100),
    seg2(x, 108, x + 300, 108),
  ];

  const view = (name: string, feetPerInch: number | null, from: number, to: number): SheetView => ({
    name,
    scaleName: feetPerInch === null ? null : '1/4" = 1\'-0"',
    feetPerInch,
    captionX: from + 0.01,
    captionY: 0.5,
    from,
    to,
    fromY: 0,
    toY: 1,
  });

  it("AN ELEVATION IS NOT MEASURED, however readable its scale is", () => {
    // ── A120: ONE PLAN, EIGHT INTERIOR ELEVATIONS, ALL NINE MEASURED ──
    //
    // An interior elevation of a wall is two parallel lines a wall-thickness
    // apart running the height of that wall — a textbook wall by every
    // geometric test in this repo, and this fixture is deliberately the SAME
    // geometry in both views to say so. Nothing downstream can tell them
    // apart. The caption is the only thing that can, so the caption decides.
    const measured = wallsPerView({
      segments: [...wallAt(100), ...wallAt(600)],
      textItems: [],
      pageSize: page,
      views: [view("ENLARGED PLAN", 4, 0, 0.5), view("RR 105 - EAST ELEV.", 4, 0.5, 1)],
      wallTypes: [],
      feetPerUnit: 40,
    });
    expect(measured.map((m) => m.view.name), "the elevation was measured").toEqual([
      "ENLARGED PLAN",
    ]);
  });

  it("a caption nobody recognises is not measured EITHER, and is named instead", () => {
    // "check" is its own answer: measuring an unrecognised drawing is how
    // eight elevations reached a bid, and dropping it in silence loses an
    // estimator a drawing without telling them.
    const odd = view("BLDG SECT A-A THRU LOBBY WALL", 4, 0.5, 1);
    const measured = wallsPerView({
      segments: [...wallAt(100), ...wallAt(600)],
      textItems: [],
      pageSize: page,
      views: [view("ENLARGED PLAN", 4, 0, 0.5), odd],
      wallTypes: [],
      feetPerUnit: 40,
    });
    expect(measured.map((m) => m.view.name)).toEqual(["ENLARGED PLAN"]);
    expect(excludedViews([odd])[0].reason).toMatch(/section/i);
  });

  it("A VIEW WITH NO READABLE SCALE IS NOT MEASURED, and does not borrow a neighbour's", () => {
    // A-401's HEAD OF WALL DETAIL is NTS. Measured at the stair plan's scale
    // it added hundreds of feet of cross-section hatching as wall. There is no
    // right answer for NTS, so the only honest one is to report nothing.
    const measured = wallsPerView({
      segments: [...wallAt(100), ...wallAt(600)],
      textItems: [],
      pageSize: page,
      views: [view("PLAN", 4, 0, 0.5), view("DETAIL", null, 0.5, 1)],
      wallTypes: [],
      feetPerUnit: 40,
    });
    expect(measured.map((m) => m.view.name), "the NTS view was measured").toEqual(["PLAN"]);
  });

  it("still measures the view that DOES have a scale", () => {
    const measured = wallsPerView({
      segments: wallAt(100),
      textItems: [],
      pageSize: page,
      views: [view("PLAN", 4, 0, 0.5)],
      wallTypes: [],
      feetPerUnit: 40,
    });
    expect(measured).toHaveLength(1);
    expect(measured[0].lengthFeet).toBeGreaterThan(0);
  });
});

describe("which drawings were left out", () => {
  const view = (name: string, feetPerInch: number | null): SheetView => ({
    name,
    scaleName: feetPerInch === null ? null : '1/4" = 1\'-0"',
    feetPerInch,
    captionX: 0.1,
    captionY: 0.5,
    from: 0,
    to: 1,
    fromY: 0,
    toY: 1,
  });

  it("names the ones with no readable scale, and only those", () => {
    const left = excludedViews([view("FLOOR PLAN", 4), view("HEAD OF WALL DETAIL", null)]);
    expect(left.map((o) => o.name)).toEqual(["HEAD OF WALL DETAIL"]);
  });

  it("GIVES A REASON AN ESTIMATOR CAN ACT ON, not just a flag", () => {
    // "skipped" tells somebody to worry; "not to scale" tells them why and
    // lets them decide whether it matters.
    const left = excludedViews([view("HEAD OF WALL DETAIL", null)]);
    expect(left[0].reason).toMatch(/not to scale/i);
    expect(left[0].reason).toMatch(/not measured/i);
  });

  it("is empty when every drawing could be measured", () => {
    expect(excludedViews([view("FLOOR PLAN", 4), view("ENLARGED BATH PLAN", 2)])).toEqual([]);
  });
});
