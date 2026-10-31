import { describe, expect, it } from "vitest";
import { buildJobGuide, DATE_HEADS_UP_DAYS, DUE_SOON_HOURS, guideDueMs } from "./buildJobGuide";
import { buildGuidesFromFacts } from "./index";
import { isOpenForGuide, type GuideAddendumFact, type GuideWallTypeFact, type JobGuideFacts } from "./facts";
import { GUIDE_STEP_KEYS, type GuideRailStatus } from "./types";
import { WALL_HEIGHT_CHOICES, parseWallHeightArg } from "./wallHeight";
import { needsYou } from "./homeView";
import { BOARD_LAYER_CHOICES, parseBoardLayersArg } from "./boardLayers";
import { money } from "@/lib/money";

/**
 * One fixture per kind of ask, the priority order between them, the rail's
 * progression, and the two promises the engine makes about its words: no
 * sentence carries a figure the facts do not hold, and every link stays in Bid.
 *
 * `NOW` is a Monday. A bid "due Thursday" is three days out (not soon); one due
 * Tuesday afternoon is inside the 48-hour window.
 */
const NOW = new Date("2026-10-26T15:00:00.000Z"); // Mon

const w2: GuideWallTypeFact = {
  wallTypeId: "wt_w2",
  code: "W2",
  name: "rated wall",
  lengthFt: 680.4,
  runCount: 3,
  openingsCount: 5,
  componentCount: 3,
  lineCount: 3,
  unpricedLineCount: 3,
};
const w1: GuideWallTypeFact = {
  wallTypeId: "wt_w1",
  code: "W1",
  name: "partition",
  lengthFt: 1240,
  runCount: 4,
  openingsCount: 9,
  componentCount: 3,
  lineCount: 3,
  unpricedLineCount: 0,
};

/** W2 with three runs and no height anywhere: those runs add nothing to the estimate. */
const w2NoHeight: GuideWallTypeFact = {
  ...w2,
  lineCount: 0,
  unpricedLineCount: 0,
  heightless: { runCount: 3, lengthFt: 680.4, token: "0a1b2c3d" },
};

/** W2 measured and sized, with a per-layer board part and no layer answer: the board can still double. */
const w2NoLayers: GuideWallTypeFact = {
  ...w2,
  lineCount: 0,
  unpricedLineCount: 0,
  layersUnanswered: { runCount: 3, lengthFt: 680.4, sides: 2, token: "9f8e7d6c" },
};

const addendum2: GuideAddendumFact = {
  addendumId: "ad_2",
  reference: "2",
  issuedOn: "2026-10-20", // the Tuesday before NOW
  invitationId: "inv_hartwell",
  gcName: "Hartwell",
};

const invited = (dueDate: string | null, dueMinute: number | null = null) => [
  { id: `i-${dueDate}`, projectName: "Harbor Point", status: "INVITED" as const, dueDate, dueMinute },
];

/** A bid that is ready to send: drawings read, walls measured and priced, due Thursday. */
function ready(over: Partial<JobGuideFacts> = {}): JobGuideFacts {
  return {
    jobId: "job_1",
    name: "Harbor Point Tower",
    gcName: "Marlow Construction",
    jobBidDueDate: null,
    project: { id: "bp_1", name: "Harbor Point", bidDueDate: "2026-10-29" },
    invitations: invited("2026-10-29", 840),
    hasTakeoffPlan: true,
    planCount: 1,
    sheetCount: 6,
    sheetsRead: 6,
    sheetsMissingScale: 0,
    wallTypes: [w1],
    wallRunCount: 4,
    measuredFootageFt: 1240,
    openingsCount: 9,
    wallLineCount: 3,
    lineCount: 5,
    linesWithoutPrice: 0,
    linesWithoutCost: 0,
    bidTotal: 412_300.5,
    recap: null,
    handMeasurements: NO_HAND,
    ...over,
  };
}

const NO_HAND: JobGuideFacts["handMeasurements"] = { count: 0, lengthFt: 0 };

/**
 * The contractor walk's takeoff (2026-10-27): S02 uploaded and scaled, two
 * groups added with "Add as plain measurements — priced by hand", 237 LF, no
 * wall type, nothing on the estimate yet.
 */
const walkTakeoff = (over: Partial<JobGuideFacts> = {}): JobGuideFacts =>
  empty({
    hasTakeoffPlan: true,
    planCount: 1,
    sheetCount: 1,
    sheetsRead: 1,
    handMeasurements: { count: 14, lengthFt: 237.4 },
    ...over,
  });

const empty = (over: Partial<JobGuideFacts> = {}): JobGuideFacts =>
  ready({
    hasTakeoffPlan: false,
    planCount: 0,
    sheetCount: 0,
    sheetsRead: 0,
    wallTypes: [],
    wallRunCount: 0,
    measuredFootageFt: 0,
    openingsCount: 0,
    wallLineCount: 0,
    lineCount: 0,
    bidTotal: 0,
    ...over,
  });

const statuses = (facts: JobGuideFacts): GuideRailStatus[] => buildJobGuide(facts, NOW).steps.map((step) => step.status);

// One fixture per ask kind.
const FIXTURES = {
  "no-drawings": empty(),
  "no-scale": empty({ hasTakeoffPlan: true, planCount: 1, sheetCount: 6, sheetsRead: 6, sheetsMissingScale: 2 }),
  "no-walls-measured": empty({ hasTakeoffPlan: true, planCount: 1, sheetCount: 6, sheetsRead: 6 }),
  "walls-not-added": empty({
    hasTakeoffPlan: true,
    planCount: 1,
    sheetCount: 6,
    sheetsRead: 6,
    wallTypes: [{ ...w1, lineCount: 0 }],
    wallRunCount: 4,
    measuredFootageFt: 1240,
    openingsCount: 9,
  }),
  "unpriced-wall-types": ready({ wallTypes: [w1, w2], linesWithoutPrice: 3, lineCount: 8, measuredFootageFt: 1920.4 }),
  "unpriced-lines": ready({ linesWithoutPrice: 2 }),
  "apply-recap": ready({ recap: { appliedAt: null, addedTotal: 38_250.75, landsAt: 450_551.25 } }),
  "proposal-ready": ready(),
  "send-due-soon": ready({ invitations: invited("2026-10-27", 840) }),
  "wall-height": ready({ wallTypes: [w1, w2NoHeight], wallLineCount: 3 }),
  "board-layers": ready({ wallTypes: [w1, w2NoLayers], wallLineCount: 3 }),
  "job-walk": empty({ invitations: [{ ...invited("2026-11-05", 840)[0]!, walkDate: "2026-10-27", walkMinute: 540 }] }),
  "rfi-cutoff": ready({ invitations: [{ ...invited("2026-11-05", 840)[0]!, rfiCutoffDate: "2026-10-28", gcName: "Marlow" }] }),
  "addendum-unacknowledged": ready({ unacknowledgedAddenda: [addendum2] }),
} satisfies Record<string, JobGuideFacts>;

/** The asks whose actions are tap answers: no primary, and the answers are chips. */
const CHIP_ASKS = new Set(["wall-height", "board-layers"]);

describe("one fixture per ask", () => {
  for (const [id, facts] of Object.entries(FIXTURES)) {
    it(`${id} fires, on its own step, with one primary action`, () => {
      const guide = buildJobGuide(facts, NOW);
      expect(guide.ask?.id).toBe(id);
      if (CHIP_ASKS.has(id)) {
        // Tap answers are equals: none is chosen for the person.
        expect(guide.ask!.actions.filter((action) => action.primary).length).toBe(0);
        expect(guide.ask!.actions.filter((action) => action.chip).length).toBeGreaterThanOrEqual(2);
      } else {
        expect(guide.ask!.actions.filter((action) => action.primary).length).toBe(1);
        expect(guide.ask!.actions.some((action) => action.chip)).toBe(false);
      }
      for (const action of guide.ask!.actions) {
        expect(Boolean(action.href) !== Boolean(action.actionId)).toBe(true); // exactly one of the two
      }
      const current = guide.steps.filter((step) => step.status === "current");
      expect(current).toHaveLength(1);
      // A walls ask on an estimate whose lines are already priced (wall height,
      // board layers) leaves the rail where the pricing got to; every other
      // ask is the current step.
      if (guide.ask!.step === "walls" && facts.lineCount > 0) {
        expect(GUIDE_STEP_KEYS.indexOf(current[0]!.key)).toBeGreaterThan(GUIDE_STEP_KEYS.indexOf("walls"));
      } else {
        expect(current[0]!.key).toBe(guide.ask!.step);
      }
    });
  }

  it("no-drawings sends them to the job's Bid takeoff", () => {
    const ask = buildJobGuide(FIXTURES["no-drawings"], NOW).ask!;
    expect(ask.actions[0]).toMatchObject({ href: "/bid/estimates/job_1/takeoff", primary: true });
    expect(ask.step).toBe("walls"); // an invitation is linked, so the invite step is done
    expect(buildJobGuide(empty({ invitations: [], project: null }), NOW).ask!.step).toBe("invite");
  });

  it("no-scale counts the sheets and names them in the plural or singular", () => {
    expect(buildJobGuide(FIXTURES["no-scale"], NOW).ask!.title).toBe("2 plan sheets have no scale set.");
    expect(buildJobGuide({ ...FIXTURES["no-scale"], sheetsMissingScale: 1 }, NOW).ask!.title).toBe("1 plan sheet has no scale set.");
  });

  it("unpriced-wall-types names the type and its footage, as the brief words it", () => {
    const facts = ready({ wallTypes: [w2], linesWithoutPrice: 3 });
    const ask = buildJobGuide(facts, NOW).ask!;
    expect(ask.title).toBe("W2 rated wall (680 LF) has no price in your price book.");
    expect(ask.actions[0]).toMatchObject({ label: "Add a price", href: "/bid/price-book", primary: true });
  });

  it("unpriced-wall-types says how many others are unpriced", () => {
    const facts = ready({ wallTypes: [w1, w2, { ...w2, code: "W3", wallTypeId: "wt_w3", name: "shaft wall" }], linesWithoutPrice: 6 });
    const guide = buildJobGuide(facts, NOW);
    expect(guide.ask!.title).toContain("W2 rated wall");
    expect(guide.ask!.body).toContain("1 other wall type is unpriced too.");
    expect(guide.oneLine).toBe("W2 and 1 more wall type have no price");
  });

  it("a wall type with no components is unpriced and says why", () => {
    const facts = ready({ wallTypes: [{ ...w2, componentCount: 0, lineCount: 0, unpricedLineCount: 0 }] });
    expect(buildJobGuide(facts, NOW).ask!.body).toContain("no materials or labor set up");
  });

  it("apply-recap names the action, carries the job id, and says what Apply does to the bid on the lines", () => {
    const ask = buildJobGuide(FIXTURES["apply-recap"], NOW).ask!;
    expect(ask.actions[0]).toEqual({ label: "Apply the recap", actionId: "applyRecap", actionArg: "job_1", primary: true });
    expect(ask.body).toBe(`Applying it raises the bid by ${money(38_250.75)}, from ${money(412_300.5)} to ${money(450_551.25)}.`);
    expect(ask.actions[1]).toMatchObject({ href: "/bid/estimates/job_1/recap" });
  });

  // THE CONTRACTOR WALK, 2026-10-27. Typed line prices $34,915.00; the recap's
  // rates put the bid at $31,917.00 over $24,532.00 of cost; Apply wrote lines
  // totalling $31,990.50. The ask said "Applying it adds $7,385.00 to the bid"
  // — the markup over COST — and pressing Apply LOWERED the bid by $2,924.50.
  it("apply-recap states the real change, from the lines now to what Apply writes — a cut, when the prices were above the recap", () => {
    const facts = ready({ bidTotal: 34_915, recap: { appliedAt: null, addedTotal: 7_385, landsAt: 31_990.5 } });
    const ask = buildJobGuide(facts, NOW).ask!;
    expect(ask.id).toBe("apply-recap");
    expect(ask.body).toBe("Applying it lowers the bid by $2,924.50, from $34,915.00 to $31,990.50.");
    expect(ask.body).not.toContain("7,385");
    expect(ask.body).not.toContain("adds");
  });

  it("apply-recap says the bid stays put when Apply would land on the same total", () => {
    const facts = ready({ bidTotal: 31_990.5, recap: { appliedAt: null, addedTotal: 7_385, landsAt: 31_990.5 } });
    expect(buildJobGuide(facts, NOW).ask!.body).toBe("Applying it leaves the bid at $31,990.50.");
  });

  it("apply-recap names no figure when Apply would write nothing", () => {
    const facts = ready({ bidTotal: 500, recap: { appliedAt: null, addedTotal: 40, landsAt: null } });
    expect(buildJobGuide(facts, NOW).ask!.body).toBe("Applying it puts your markup on the line prices.");
  });

  it("an applied recap asks for nothing", () => {
    const facts = ready({ recap: { appliedAt: "2026-10-25", addedTotal: 100, landsAt: null } });
    expect(buildJobGuide(facts, NOW).ask!.id).toBe("proposal-ready");
  });

  it("proposal-ready opens the Bid proposal and quotes the bid", () => {
    const guide = buildJobGuide(FIXTURES["proposal-ready"], NOW);
    expect(guide.ask!.title).toBe(`The proposal is ready to open at ${money(412_300.5)}.`);
    expect(guide.ask!.actions[0]).toMatchObject({ href: "/bid/estimates/job_1/proposal", primary: true });
    expect(guide.tone).toBe("ready");
    expect(guide.dueLabel).toBe("due Thu 2:00 PM");
    expect(guide.bidSoFar).toBe(412_300.5);
  });

  it("send-due-soon fires inside the window, and not outside it", () => {
    expect(DUE_SOON_HOURS).toBe(48);
    const guide = buildJobGuide(FIXTURES["send-due-soon"], NOW);
    expect(guide.ask!.title).toBe("This bid is due tomorrow 2:00 PM and has not gone out yet.");
    // 2026-10-28 14:00 is 47 hours out: inside. 2026-10-28 16:00 is 49 hours out: outside.
    const at = (dueMinute: number) => buildJobGuide(ready({ invitations: invited("2026-10-28", dueMinute) }), NOW).ask!.id;
    expect(at(14 * 60)).toBe("send-due-soon");
    expect(at(16 * 60)).toBe("proposal-ready");
  });

  it("a bid past its deadline reads as blocked and says so", () => {
    const guide = buildJobGuide(ready({ invitations: invited("2026-10-26", 600) }), NOW);
    expect(guide.ask!.id).toBe("send-due-soon");
    expect(guide.ask!.title).toBe("This bid was due Mon 10:00 AM and has not gone out.");
    expect(guide.tone).toBe("blocked");
    expect(guide.oneLine).toBe("Past due and not sent");
    expect(guide.dueLabel).toBe("past due (Mon 10:00 AM)");
  });

  it("a deadline with no time of day lasts until the end of that day", () => {
    const guide = buildJobGuide(ready({ invitations: invited("2026-10-26", null) }), NOW);
    expect(guide.ask!.id).toBe("send-due-soon");
    expect(guide.tone).toBe("ready"); // 15:00 on the due day: not yet past
  });
});

describe("usePastPrice", () => {
  const suggestion = { wallTypeCode: "W2", label: `a 6" 1-HR wall`, fromJobName: "Civic Center", whenLabel: "in September" };

  it("puts the suggestion in the body and makes it the primary action, passing the wall type code", () => {
    const facts = ready({ wallTypes: [w1, w2], linesWithoutPrice: 3, pastPriceSuggestions: [suggestion] });
    const ask = buildJobGuide(facts, NOW).ask!;
    expect(ask.body).toBe(`You priced a 6" 1-HR wall on Civic Center in September. Use that?`);
    expect(ask.actions[0]).toEqual({ label: "Use that price", actionId: "usePastPrice", actionArg: "W2", primary: true });
    expect(ask.actions[1]).toMatchObject({ href: "/bid/price-book" });
    expect(ask.actions[1]!.primary).toBeUndefined();
  });

  it("ignores a suggestion for a wall type that is not the first unpriced one", () => {
    const facts = ready({
      wallTypes: [w2, { ...w2, code: "W5", wallTypeId: "wt_w5" }],
      pastPriceSuggestions: [{ ...suggestion, wallTypeCode: "W5" }],
    });
    const ask = buildJobGuide(facts, NOW).ask!;
    expect(ask.actions[0]).toMatchObject({ label: "Add a price", href: "/bid/price-book", primary: true });
    expect(ask.body).not.toContain("Civic Center");
  });
});

describe("wall-height: the question the drawings do not settle", () => {
  const guide = buildJobGuide(FIXTURES["wall-height"], NOW);
  const ask = guide.ask!;

  it("asks it short, by the type's tag and the job's name, and says why it matters", () => {
    expect(ask.title).toBe("How tall are the W2 walls on Harbor Point Tower?");
    expect(ask.body).toBe(
      "3 runs of W2 (680 LF) have no height, so they add nothing to the estimate yet. Your answer becomes W2's default height in your wall types.",
    );
    expect(ask.step).toBe("walls");
    expect(guide.oneLine).toBe("W2 walls need a height");
    expect(guide.tone).toBe("question");
  });

  it("offers the common heights as tap answers, each carrying the question's own arg", () => {
    const chips = ask.actions.filter((action) => action.chip);
    expect(chips.map((action) => action.label)).toEqual(WALL_HEIGHT_CHOICES.map((h) => `${h} ft`));
    for (const [i, chip] of chips.entries()) {
      expect(chip.actionId).toBe("setWallHeight");
      expect(chip.href).toBeUndefined();
      expect(parseWallHeightArg(chip.actionArg)).toEqual({ wallTypeId: "wt_w2", heightFt: WALL_HEIGHT_CHOICES[i], token: "0a1b2c3d" });
      // The write reaches past this estimate, and the confirm says so.
      expect(chip.confirm).toBe(
        `Make W2 ${WALL_HEIGHT_CHOICES[i]} ft tall in your wall types, and work this estimate's walls out again from them?`,
      );
    }
  });

  it("anything else is typed in Bid's own wall-type library", () => {
    const other = ask.actions.find((action) => !action.chip)!;
    expect(other).toEqual({ label: "Another height", href: "/bid/wall-types" });
  });

  it("names the other types that need a height too, singular and plural", () => {
    const w3 = { ...w2NoHeight, code: "W3", wallTypeId: "wt_w3" };
    const two = buildJobGuide(ready({ wallTypes: [w2NoHeight, w3] }), NOW);
    expect(two.ask!.body).toContain(" 1 other wall type needs a height too.");
    expect(two.oneLine).toBe("W2 and 1 more wall type need a height");
    const w4 = { ...w3, code: "W4", wallTypeId: "wt_w4" };
    expect(buildJobGuide(ready({ wallTypes: [w2NoHeight, w3, w4] }), NOW).ask!.body).toContain(" 2 other wall types need a height too.");
  });

  it("one run reads in the singular", () => {
    const one = { ...w2NoHeight, heightless: { runCount: 1, lengthFt: 42, token: "0a1b2c3d" } };
    expect(buildJobGuide(ready({ wallTypes: [one] }), NOW).ask!.body).toMatch(/^1 run of W2 \(42 LF\) has no height, so it adds nothing/);
  });

  it("is not asked of a type with no components — that one is unpriced, and says so", () => {
    const bare = { ...w2NoHeight, componentCount: 0 };
    const other = buildJobGuide(ready({ wallTypes: [bare] }), NOW).ask!;
    expect(other.id).toBe("unpriced-wall-types");
    expect(other.body).toContain("no materials or labor set up");
  });

  it("is not asked once the type has a height (heightless cleared)", () => {
    expect(buildJobGuide(ready({ wallTypes: [w1, { ...w2NoHeight, heightless: null }] }), NOW).ask!.id).toBe("proposal-ready");
    expect(buildJobGuide(ready({ wallTypes: [w1, { ...w2NoHeight, heightless: { runCount: 0, lengthFt: 0, token: "x" } }] }), NOW).ask!.id).toBe(
      "proposal-ready",
    );
  });
});

describe("board-layers: how many layers of board, which the drawings often leave to a detail", () => {
  const guide = buildJobGuide(FIXTURES["board-layers"], NOW);
  const ask = guide.ask!;

  it("asks it short, by the type's tag and the job's name, with the footage it affects", () => {
    expect(ask.title).toBe("How many layers of board are on the W2 walls on Harbor Point Tower?");
    expect(ask.body).toBe(
      "3 runs of W2 (680 LF) are counted at one layer each side until you say. Two layers doubles the board. Your answer becomes W2's board layers in your wall types.",
    );
    expect(ask.step).toBe("walls");
    expect(guide.headline).toBe("Walls are measured. One thing needs you.");
    expect(guide.oneLine).toBe("W2 walls need a board layer count");
    expect(guide.tone).toBe("question");
  });

  it("offers 1 and 2 layers as tap answers, each carrying the question's own arg and its own confirm", () => {
    const chips = ask.actions.filter((action) => action.chip);
    expect(chips.map((action) => action.label)).toEqual(["1 layer each side", "2 layers each side"]);
    for (const [i, chip] of chips.entries()) {
      expect(chip.actionId).toBe("setBoardLayers");
      expect(chip.href).toBeUndefined();
      expect(chip.primary).toBeUndefined();
      expect(parseBoardLayersArg(chip.actionArg)).toEqual({ wallTypeId: "wt_w2", layers: BOARD_LAYER_CHOICES[i], token: "9f8e7d6c" });
    }
    // The write reaches past this estimate, and the confirm says so.
    expect(chips.map((chip) => chip.confirm)).toEqual([
      "Make W2 1 layer of board each side in your wall types, and work this estimate's walls out again from them?",
      "Make W2 2 layers of board each side in your wall types, and work this estimate's walls out again from them?",
    ]);
  });

  it("three or more is picked in Bid's own wall-type library", () => {
    expect(ask.actions.find((action) => !action.chip)).toEqual({ label: "Three or more", href: "/bid/wall-types" });
  });

  it("a one-sided type (furring) says its one side, and the chips do not say 'each side'", () => {
    const furring = { ...w2NoLayers, layersUnanswered: { ...w2NoLayers.layersUnanswered!, sides: 1 } };
    const one = buildJobGuide(ready({ wallTypes: [furring] }), NOW).ask!;
    expect(one.body).toContain("counted at one layer on its one boarded side until you say");
    expect(one.actions.filter((action) => action.chip).map((action) => action.label)).toEqual(["1 layer", "2 layers"]);
    expect(one.actions[1]!.confirm).toBe(
      "Make W2 2 layers of board on its one boarded side in your wall types, and work this estimate's walls out again from them?",
    );
  });

  it("names the other types that need a count too, and one run reads in the singular", () => {
    const w3 = { ...w2NoLayers, code: "W3", wallTypeId: "wt_w3" };
    const two = buildJobGuide(ready({ wallTypes: [w2NoLayers, w3] }), NOW);
    expect(two.ask!.body).toContain(" 1 other wall type needs a layer count too.");
    expect(two.oneLine).toBe("W2 and 1 more wall type need a board layer count");
    const single = { ...w2NoLayers, layersUnanswered: { runCount: 1, lengthFt: 42, sides: 2, token: "9f8e7d6c" } };
    expect(buildJobGuide(ready({ wallTypes: [single] }), NOW).ask!.body).toMatch(/^1 run of W2 \(42 LF\) is counted at one layer/);
  });

  it("is not asked once answered, or of a type with no parts (that one is unpriced, and says so)", () => {
    expect(buildJobGuide(ready({ wallTypes: [w1, { ...w2NoLayers, layersUnanswered: null }] }), NOW).ask!.id).toBe("proposal-ready");
    const noRuns = { ...w2NoLayers, layersUnanswered: { runCount: 0, lengthFt: 0, sides: 2, token: "x" } };
    expect(buildJobGuide(ready({ wallTypes: [w1, noRuns] }), NOW).ask!.id).toBe("proposal-ready");
    expect(buildJobGuide(ready({ wallTypes: [{ ...w2NoLayers, componentCount: 0 }] }), NOW).ask!.id).toBe("unpriced-wall-types");
  });

  it("names traced takeoff items with the runs, and the footage is both", () => {
    const mixed = { ...w2NoLayers, layersUnanswered: { runCount: 3, itemCount: 1, lengthFt: 720.4, sides: 2, token: "9f8e7d6c" } };
    expect(buildJobGuide(ready({ wallTypes: [mixed] }), NOW).ask!.body).toMatch(
      /^3 runs and 1 takeoff item of W2 \(720 LF\) are counted at one layer each side until you say\./,
    );
  });

  it("asks about a type used ONLY through takeoff items — no runs, and nothing else counts it as measured", () => {
    // As the loader adds it: runCount 0, no length of its own, no wall lines.
    const itemOnly: GuideWallTypeFact = {
      ...w2NoLayers,
      wallTypeId: "wt_t1",
      code: "T1",
      lengthFt: 0,
      runCount: 0,
      openingsCount: 0,
      lineCount: 0,
      unpricedLineCount: 0,
      heightless: null,
      layersUnanswered: { runCount: 0, itemCount: 1, lengthFt: 40, sides: 2, token: "1a2b3c4d" },
    };
    const guide = buildJobGuide(ready({ wallTypes: [w1, itemOnly] }), NOW);
    expect(guide.ask!.id).toBe("board-layers");
    expect(guide.ask!.body).toMatch(/^1 takeoff item of T1 \(40 LF\) is counted at one layer each side until you say\./);
    expect(guide.ask!.actions[0]!.actionArg).toBe("bl:wt_t1:1:1a2b3c4d");
    // Answered, it is gone and the bid reads ready — it was never an unpriced wall type.
    const answered = { ...itemOnly, layersUnanswered: null };
    expect(buildJobGuide(ready({ wallTypes: [w1, answered] }), NOW).ask!.id).toBe("proposal-ready");
    // And it cannot make "add the walls to the estimate" fire for runs of a type with no parts.
    const bareRuns = { ...w1, componentCount: 0, lineCount: 0 };
    const facts = ready({ wallTypes: [bareRuns, answered], wallLineCount: 0, lineCount: 0 });
    expect(buildJobGuide(facts, NOW).ask!.id).not.toBe("walls-not-added");
  });

  it("ranks AFTER the height (a run with no height produces nothing at all) and BEFORE adding the walls and every price ask", () => {
    const both = { ...w2NoHeight, layersUnanswered: w2NoLayers.layersUnanswered };
    expect(buildJobGuide(ready({ wallTypes: [both] }), NOW).ask!.id).toBe("wall-height");
    // height answered: now the layers
    const noLines = ready({ wallTypes: [w2NoLayers], wallLineCount: 0, linesWithoutPrice: 4, recap: { appliedAt: null, addedTotal: 1, landsAt: null } });
    expect(buildJobGuide(noLines, NOW).ask!.id).toBe("board-layers");
    // layers answered: the earlier rules take over again, in order
    expect(buildJobGuide({ ...noLines, wallTypes: [{ ...w2NoLayers, layersUnanswered: null }] }, NOW).ask!.id).toBe("walls-not-added");
    const unpriced = ready({ wallTypes: [w2, w2NoLayers], linesWithoutPrice: 3 });
    expect(buildJobGuide(unpriced, NOW).ask!.id).toBe("board-layers");
    expect(buildJobGuide({ ...unpriced, wallTypes: [w2] }, NOW).ask!.id).toBe("unpriced-wall-types");
  });
});

describe("dates that pass on their own: the job walk and the RFI cutoff", () => {
  const withDates = (dates: Partial<JobGuideFacts["invitations"][number]>, over: Partial<JobGuideFacts> = {}, dueDate = "2026-11-05") =>
    ready({ invitations: [{ ...invited(dueDate, 840)[0]!, ...dates }], ...over });

  it("job-walk says when, at the GC's wall-clock time, and points at the bid in the bid log", () => {
    const guide = buildJobGuide(FIXTURES["job-walk"], NOW);
    expect(guide.ask!.title).toBe("The job walk is tomorrow at 9:00 AM.");
    expect(guide.ask!.body).toBe("Bring the plan set and a list of what the drawings leave open.");
    expect(guide.ask!.actions).toEqual([{ label: "See the bid", href: "/bid/bids#i-2026-11-05", primary: true }]);
    expect(guide.oneLine).toBe("Job walk tomorrow 9:00 AM");
    expect(guide.headline).toBe("The job walk is coming up.");
    expect(guide.tone).toBe("update");
  });

  it("job-walk sits on the step the work is on, so the rail does not move", () => {
    expect(buildJobGuide(FIXTURES["job-walk"], NOW).ask!.step).toBe("walls");
    expect(buildJobGuide(withDates({ walkDate: "2026-10-27" }), NOW).ask!.step).toBe("proposal");
    expect(statuses(withDates({ walkDate: "2026-10-27" }))).toEqual(statuses(ready({ invitations: invited("2026-11-05", 840) })));
  });

  it("a walk with no time, and one today, read as people say them", () => {
    expect(buildJobGuide(withDates({ walkDate: "2026-10-26", walkMinute: null }), NOW).ask!.title).toBe("The job walk is today.");
    expect(buildJobGuide(withDates({ walkDate: "2026-10-28", walkMinute: 600 }), NOW).ask!.title).toBe(
      "The job walk is Wednesday at 10:00 AM.",
    );
  });

  it("a walk today is shown all day, even after its (unzoned) minute", () => {
    // NOW is 15:00 UTC; a 9:00 AM walk on the GC's clock may not have started yet.
    expect(buildJobGuide(withDates({ walkDate: "2026-10-26", walkMinute: 540 }), NOW).ask!.id).toBe("job-walk");
  });

  it(`fires up to ${DATE_HEADS_UP_DAYS} days out and not one day more; never for a day gone by`, () => {
    expect(DATE_HEADS_UP_DAYS).toBe(2);
    expect(buildJobGuide(withDates({ walkDate: "2026-10-28" }), NOW).ask!.id).toBe("job-walk");
    expect(buildJobGuide(withDates({ walkDate: "2026-10-29" }), NOW).ask!.id).toBe("proposal-ready");
    expect(buildJobGuide(withDates({ walkDate: "2026-10-25" }), NOW).ask!.id).toBe("proposal-ready");
    expect(buildJobGuide(withDates({ rfiCutoffDate: "2026-10-28" }), NOW).ask!.id).toBe("rfi-cutoff");
    expect(buildJobGuide(withDates({ rfiCutoffDate: "2026-10-29" }), NOW).ask!.id).toBe("proposal-ready");
    expect(buildJobGuide(withDates({ rfiCutoffDate: "2026-10-25" }), NOW).ask!.id).toBe("proposal-ready");
  });

  it("rfi-cutoff names the day and the GC", () => {
    const guide = buildJobGuide(FIXTURES["rfi-cutoff"], NOW);
    expect(guide.ask!.title).toBe("RFI questions are due Wednesday.");
    expect(guide.ask!.body).toBe("Send Marlow anything the drawings leave open before then. After that, you price what you assume.");
    expect(guide.oneLine).toBe("RFIs close Wed");
    expect(buildJobGuide(withDates({ rfiCutoffDate: "2026-10-27" }), NOW).ask!.body).toContain("Send the GC anything");
    expect(buildJobGuide(withDates({ rfiCutoffDate: "2026-10-27" }), NOW).ask!.title).toBe("RFI questions are due tomorrow.");
  });

  it("the sooner date wins; on the same day the walk comes first", () => {
    expect(buildJobGuide(withDates({ walkDate: "2026-10-28", rfiCutoffDate: "2026-10-27" }), NOW).ask!.id).toBe("rfi-cutoff");
    expect(buildJobGuide(withDates({ walkDate: "2026-10-27", rfiCutoffDate: "2026-10-27" }), NOW).ask!.id).toBe("job-walk");
    // Across two GCs: the earlier walk.
    const two = ready({
      invitations: [
        { ...invited("2026-11-05")[0]!, id: "a", walkDate: "2026-10-28", walkMinute: 600 },
        { ...invited("2026-11-06")[0]!, id: "b", walkDate: "2026-10-27", walkMinute: 840 },
      ],
    });
    expect(buildJobGuide(two, NOW).ask!.actions[0]!.href).toBe("/bid/bids#b");
  });

  it("only a still-open invitation's dates count", () => {
    const declined = ready({
      invitations: [{ id: "d", projectName: "p", status: "DECLINED", dueDate: null, dueMinute: null, walkDate: "2026-10-27" }],
    });
    expect(buildJobGuide(declined, NOW).ask!.id).toBe("proposal-ready");
    const sent = ready({
      invitations: [{ id: "s", projectName: "p", status: "SUBMITTED", dueDate: null, dueMinute: null, walkDate: "2026-10-27" }],
    });
    expect(buildJobGuide(sent, NOW).ask).toBeNull();
  });
});

describe("addendum-unacknowledged: the paper that gets a bid thrown out", () => {
  it("names the addendum, when it was issued and whose form is missing it", () => {
    const guide = buildJobGuide(FIXTURES["addendum-unacknowledged"], NOW);
    expect(guide.ask!.title).toBe("Addendum 2 was issued Tuesday and isn't acknowledged on Hartwell's bid form yet.");
    expect(guide.ask!.body).toBe(
      "A bid form missing an acknowledgement can be thrown out unread. Once it is on the form, record the date in the bid log.",
    );
    expect(guide.ask!.step).toBe("proposal");
    expect(guide.oneLine).toBe("Addendum 2 not acknowledged");
    expect(guide.tone).toBe("question");
  });

  it("links to the bid log row (where it is recorded) and the bid's addenda (where it is read), both in Bid", () => {
    const ask = buildJobGuide(FIXTURES["addendum-unacknowledged"], NOW).ask!;
    expect(ask.actions).toEqual([
      { label: "Open the bid log", href: "/bid/bids#inv_hartwell", primary: true },
      { label: "Read the addendum", href: "/bid/bids/inv_hartwell?tab=addenda" },
    ]);
  });

  it("keeps the GC's own words, and reads without a date or a GC", () => {
    const asi = { ...addendum2, reference: "ASI 3", issuedOn: null, gcName: null };
    expect(buildJobGuide(ready({ unacknowledgedAddenda: [asi] }), NOW).ask!.title).toBe("ASI 3 isn't acknowledged on the bid form yet.");
    const old = { ...addendum2, reference: "Addendum No. 4", issuedOn: "2026-10-02", gcName: "Ross Builders" };
    expect(buildJobGuide(ready({ unacknowledgedAddenda: [old] }), NOW).ask!.title).toBe(
      "Addendum No. 4 was issued Oct 2 and isn't acknowledged on Ross Builders' bid form yet.",
    );
    expect(buildJobGuide(ready({ unacknowledgedAddenda: [{ ...addendum2, issuedOn: "2026-10-26" }] }), NOW).ask!.title).toContain(
      "was issued today",
    );
  });

  it("counts the others, each GC's form on its own", () => {
    const onTwoForms = [addendum2, { ...addendum2, invitationId: "inv_marlow", gcName: "Marlow" }];
    const guide = buildJobGuide(ready({ unacknowledgedAddenda: onTwoForms }), NOW);
    expect(guide.ask!.body).toContain(" 1 other acknowledgement is missing too.");
    expect(guide.oneLine).toBe("Addendum 2 and 1 more not acknowledged");
  });
});

describe("priority: where the new asks sit", () => {
  const walkTomorrow = { walkDate: "2026-10-27", walkMinute: 540 };

  it("a walk or an RFI cutoff inside two days comes before even the drawings", () => {
    expect(buildJobGuide(FIXTURES["job-walk"], NOW).ask!.id).toBe("job-walk");
    const noDrawings = empty({ invitations: [{ ...invited("2026-11-05")[0]!, rfiCutoffDate: "2026-10-27" }] });
    expect(buildJobGuide(noDrawings, NOW).ask!.id).toBe("rfi-cutoff");
    expect(buildJobGuide({ ...FIXTURES["wall-height"], invitations: FIXTURES["job-walk"].invitations }, NOW).ask!.id).toBe("job-walk");
  });

  it("but a bid due inside the window still says what blocks it, not the walk", () => {
    // Due tomorrow 2:00 PM (inside 48h) with the walk also tomorrow: the work comes first.
    const blocked = empty({ invitations: [{ ...invited("2026-10-27", 840)[0]!, ...walkTomorrow }] });
    const guide = buildJobGuide(blocked, NOW);
    expect(guide.ask!.id).toBe("no-drawings");
    expect(guide.dueLabel).toBe("due tomorrow 2:00 PM");
    // And priced, it is the sending, not the walk.
    expect(buildJobGuide(ready({ invitations: [{ ...invited("2026-10-27", 840)[0]!, ...walkTomorrow }] }), NOW).ask!.id).toBe(
      "send-due-soon",
    );
    // 49 hours out is outside the window again, and the walk is back.
    expect(buildJobGuide(ready({ invitations: [{ ...invited("2026-10-28", 16 * 60)[0]!, ...walkTomorrow }] }), NOW).ask!.id).toBe(
      "job-walk",
    );
    // Past due is "due soon" too.
    expect(buildJobGuide(ready({ invitations: [{ ...invited("2026-10-26", 600)[0]!, ...walkTomorrow }] }), NOW).ask!.id).toBe(
      "send-due-soon",
    );
  });

  it("wall-height beats adding the walls, and every price ask", () => {
    const noLines = ready({ wallTypes: [w2NoHeight], wallLineCount: 0, linesWithoutPrice: 4, recap: { appliedAt: null, addedTotal: 1, landsAt: null } });
    expect(buildJobGuide(noLines, NOW).ask!.id).toBe("wall-height");
    // with the height answered, the earlier rules take over again in order
    const answered = { ...noLines, wallTypes: [{ ...w2NoHeight, heightless: null }] };
    expect(buildJobGuide(answered, NOW).ask!.id).toBe("walls-not-added");
    const unpriced = ready({ wallTypes: [w2, w2NoHeight], linesWithoutPrice: 3 });
    expect(buildJobGuide(unpriced, NOW).ask!.id).toBe("wall-height");
    expect(buildJobGuide({ ...unpriced, wallTypes: [w2] }, NOW).ask!.id).toBe("unpriced-wall-types");
  });

  it("measuring comes before the height question (no run, nothing to ask)", () => {
    const nothingMeasured = FIXTURES["no-walls-measured"];
    expect(buildJobGuide({ ...nothingMeasured, wallTypes: [] }, NOW).ask!.id).toBe("no-walls-measured");
  });

  it("the addendum waits for the pricing, and comes before the proposal and the sending", () => {
    const base = ready({ unacknowledgedAddenda: [addendum2], linesWithoutPrice: 2, recap: { appliedAt: null, addedTotal: 1, landsAt: null } });
    expect(buildJobGuide(base, NOW).ask!.id).toBe("unpriced-lines");
    expect(buildJobGuide({ ...base, linesWithoutPrice: 0 }, NOW).ask!.id).toBe("apply-recap");
    expect(buildJobGuide({ ...base, linesWithoutPrice: 0, recap: null }, NOW).ask!.id).toBe("addendum-unacknowledged");
    expect(buildJobGuide({ ...base, linesWithoutPrice: 0, recap: null, unacknowledgedAddenda: [] }, NOW).ask!.id).toBe("proposal-ready");
    // due tomorrow: still the addendum before "send it now", and it says it is late once past due
    const dueSoon = ready({ unacknowledgedAddenda: [addendum2], invitations: invited("2026-10-27", 840) });
    expect(buildJobGuide(dueSoon, NOW).ask!.id).toBe("addendum-unacknowledged");
    const late = buildJobGuide(ready({ unacknowledgedAddenda: [addendum2], invitations: invited("2026-10-26", 600) }), NOW);
    expect(late.ask!.id).toBe("addendum-unacknowledged");
    expect(late.tone).toBe("blocked");
    expect(late.oneLine).toBe("Past due. Addendum 2 not acknowledged");
  });

  it("once the bid is sent, none of them asks", () => {
    const sent = ready({
      invitations: [{ id: "s", projectName: "p", status: "SUBMITTED", dueDate: null, dueMinute: null }],
      wallTypes: [w2NoHeight],
      unacknowledgedAddenda: [addendum2],
    });
    expect(buildJobGuide(sent, NOW).ask).toBeNull();
  });
});

describe("priority: the earliest missing step wins", () => {
  it("no drawings beats everything", () => {
    expect(buildJobGuide(empty({ recap: { appliedAt: null, addedTotal: 5, landsAt: null }, linesWithoutPrice: 2 }), NOW).ask!.id).toBe("no-drawings");
  });
  it("no scale beats unmeasured walls", () => {
    expect(buildJobGuide(FIXTURES["no-scale"], NOW).ask!.id).toBe("no-scale");
    expect(buildJobGuide({ ...FIXTURES["no-scale"], sheetsMissingScale: 0 }, NOW).ask!.id).toBe("no-walls-measured");
  });
  it("walls not in the estimate beat unpriced wall types", () => {
    const facts = { ...FIXTURES["walls-not-added"], linesWithoutPrice: 1, recap: { appliedAt: null, addedTotal: 1, landsAt: null } };
    expect(buildJobGuide(facts, NOW).ask!.id).toBe("walls-not-added");
  });
  it("unpriced wall types beat unpriced lines, which beat the recap, which beats the proposal", () => {
    const base = ready({ wallTypes: [w2], linesWithoutPrice: 3, recap: { appliedAt: null, addedTotal: 1, landsAt: null } });
    expect(buildJobGuide(base, NOW).ask!.id).toBe("unpriced-wall-types");
    expect(buildJobGuide({ ...base, wallTypes: [w1] }, NOW).ask!.id).toBe("unpriced-lines");
    expect(buildJobGuide({ ...base, wallTypes: [w1], linesWithoutPrice: 0 }, NOW).ask!.id).toBe("apply-recap");
    expect(buildJobGuide({ ...base, wallTypes: [w1], linesWithoutPrice: 0, recap: null }, NOW).ask!.id).toBe("proposal-ready");
  });
  it("a deadline never jumps the queue ahead of missing work", () => {
    const soon = invited("2026-10-27", 600);
    expect(buildJobGuide(ready({ invitations: soon, linesWithoutPrice: 2 }), NOW).ask!.id).toBe("unpriced-lines");
    expect(buildJobGuide(ready({ invitations: soon }), NOW).ask!.id).toBe("send-due-soon");
  });
  it("a hand-built estimate with no drawings is not told to upload any", () => {
    expect(buildJobGuide(empty({ lineCount: 4, bidTotal: 9000 }), NOW).ask!.id).toBe("proposal-ready");
  });
  it("sheets without a scale stop mattering once a wall is measured", () => {
    expect(buildJobGuide(ready({ sheetsMissingScale: 3 }), NOW).ask!.id).toBe("proposal-ready");
  });
});

// THE CONTRACTOR WALK, 2026-10-27. "Add as plain measurements — priced by
// hand" put 237 LF on the takeoff with no wall type, so no `WallRun` — and the
// guide counted only wall runs. It kept asking "1 sheet is in, and no walls are
// measured yet", and once hand-typed lines were priced the rail read
// "✓ Walls measured — Done · 1 sheet, none measured yet".
describe("measurements made by hand count as measured", () => {
  it("the walk's 237 LF of plain measurements is not 'no walls measured'", () => {
    const guide = buildJobGuide(walkTakeoff(), NOW);
    expect(guide.ask!.id).not.toBe("no-walls-measured");
    expect(guide.ask!.title).not.toContain("no walls are measured");
  });

  it("measured but not on the estimate asks to add them, in footage, and sends them to the takeoff list", () => {
    const guide = buildJobGuide(walkTakeoff(), NOW);
    expect(guide.ask!.id).toBe("walls-not-added");
    expect(guide.ask!.step).toBe("walls");
    expect(guide.ask!.title).toBe("237 LF is measured by hand but not on the estimate yet.");
    expect(guide.ask!.actions[0]).toMatchObject({ href: "/bid/estimates/job_1/takeoff", primary: true });
    expect(guide.oneLine).toBe("Measurements not on the estimate");
    expect(guide.steps[1]!.summary).toBe("237 LF measured by hand · 1 sheet");
  });

  it("measurements with no length (areas, counts) are counted rather than called feet", () => {
    const facts = walkTakeoff({ handMeasurements: { count: 3, lengthFt: 0 } });
    const guide = buildJobGuide(facts, NOW);
    expect(guide.ask!.title).toBe("3 measurements are on the takeoff but not on the estimate yet.");
    expect(guide.steps[1]!.summary).toBe("3 measurements by hand · 1 sheet");
  });

  it("once lines are priced the walls step is done and its summary says what was measured, not 'none measured yet'", () => {
    const facts = walkTakeoff({ lineCount: 3, bidTotal: 34_915 });
    const guide = buildJobGuide(facts, NOW);
    expect(guide.steps[1]!.status).toBe("done");
    expect(guide.steps[1]!.summary).toBe("237 LF measured by hand · 1 sheet");
    expect(guide.steps[1]!.summary).not.toContain("none measured");
    // Lines typed in place of posting the measurements: not nagged forever.
    expect(guide.ask!.id).toBe("proposal-ready");
  });

  it("a takeoff with nothing measured and lines typed in SKIPS the walls step — no tick for walls nobody measured", () => {
    const facts = walkTakeoff({ handMeasurements: NO_HAND, lineCount: 3, bidTotal: 34_915 });
    const guide = buildJobGuide(facts, NOW);
    expect(guide.steps[1]!.status).toBe("skipped");
    expect(guide.steps[1]!.summary).toBe("1 sheet · lines typed in, nothing measured");
  });

  it("before anything is measured it still asks for the walls", () => {
    expect(buildJobGuide(walkTakeoff({ handMeasurements: NO_HAND }), NOW).ask!.id).toBe("no-walls-measured");
    expect(buildJobGuide(walkTakeoff({ handMeasurements: NO_HAND }), NOW).steps[1]!.summary).toBe("1 sheet, none measured yet");
  });

  it("a sheet with no scale stops being asked about once something is measured by hand", () => {
    expect(buildJobGuide(walkTakeoff({ sheetsMissingScale: 1 }), NOW).ask!.id).toBe("walls-not-added");
  });

  it("wall runs and hand measurements together are both in the walls summary", () => {
    const facts = ready({ handMeasurements: { count: 2, lengthFt: 60 } });
    expect(buildJobGuide(facts, NOW).steps[1]!.summary).toBe("1,240 LF · 60 LF by hand · 9 openings · 6 sheets");
  });

  it("measured wall runs not on the estimate are asked about first, in their own words", () => {
    const facts = { ...FIXTURES["walls-not-added"], handMeasurements: { count: 2, lengthFt: 60 } };
    expect(buildJobGuide(facts, NOW).ask!.title).toBe("1,240 LF of walls are measured but not in the estimate yet.");
  });
});

describe("the rail", () => {
  it("done, current, todo in order, for each stage", () => {
    const by = (id: keyof typeof FIXTURES): GuideRailStatus[] => statuses(FIXTURES[id]);
    expect(by("no-drawings")).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(by("no-scale")).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(by("unpriced-wall-types")).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(by("apply-recap")).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(by("proposal-ready")).toEqual(["done", "done", "done", "current", "todo"]);
    expect(by("send-due-soon")).toEqual(["done", "done", "done", "done", "current"]);
    expect(statuses(empty({ invitations: [], project: null }))).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });

  // THE WALK OF 2026-10-30. One typed line, nothing measured, read
  // "✓ Walls measured"; then a wall run added after three lines were priced
  // pulled the rail back to "Walls measured — Current step / Price it — Not
  // started".
  it("typed lines with no drawings and nothing measured skip the walls step", () => {
    const facts = empty({ lineCount: 1, bidTotal: 12_000 });
    expect(statuses(facts)).toEqual(["done", "skipped", "done", "current", "todo"]);
    expect(buildJobGuide(facts, NOW).steps[1]!.summary).toBe("Lines typed in, nothing measured");
  });

  it("a wall run added after the typed lines were priced does not pull the rail back to the walls", () => {
    const facts = { ...FIXTURES["walls-not-added"], lineCount: 3, bidTotal: 33_720 };
    const guide = buildJobGuide(facts, NOW);
    expect(guide.ask!.id).toBe("walls-not-added");
    expect(statuses(facts)).toEqual(["done", "done", "done", "current", "todo"]);
  });

  it("measured walls with no lines yet still sit on the walls step", () => {
    expect(statuses(FIXTURES["walls-not-added"])).toEqual(["done", "current", "todo", "todo", "todo"]);
  });

  it("is always five steps in the contract's order", () => {
    for (const facts of Object.values(FIXTURES)) {
      expect(buildJobGuide(facts, NOW).steps.map((step) => step.key)).toEqual([...GUIDE_STEP_KEYS]);
    }
  });

  it("summarises the walls the way the contract shows it", () => {
    expect(buildJobGuide(ready(), NOW).steps[1]!.summary).toBe("1,240 LF · 9 openings · 6 sheets");
  });

  it("summarises the price with the bid so far and the lines", () => {
    expect(buildJobGuide(ready(), NOW).steps[2]!.summary).toBe(`${money(412_300.5)} · 5 lines`);
    expect(buildJobGuide(ready({ linesWithoutPrice: 2 }), NOW).steps[2]!.summary).toBe(
      `${money(412_300.5)} · 5 lines · 2 without a price`,
    );
  });

  it("has no bid so far until something is priced", () => {
    expect(buildJobGuide(empty(), NOW).bidSoFar).toBeNull();
  });
});

describe("once the bid has gone out", () => {
  const sent = (status: "SUBMITTED" | "WON" | "LOST") =>
    ready({
      invitations: [{ id: "i", projectName: "p", status, dueDate: "2026-10-27", dueMinute: 600 }],
      recap: { appliedAt: null, addedTotal: 9, landsAt: null },
    });

  for (const status of ["SUBMITTED", "WON", "LOST"] as const) {
    it(`${status} leaves no ask, all five steps done, and no deadline`, () => {
      const guide = buildJobGuide(sent(status), NOW);
      expect(guide.ask).toBeNull();
      expect(guide.tone).toBe("working");
      expect(guide.dueLabel).toBeNull();
      expect(guide.steps.every((step) => step.status === "done")).toBe(true);
      expect(guide.steps[4]!.summary).toBe("Sent");
    });
  }

  it("a DECLINED invitation sent nothing", () => {
    const facts = ready({ invitations: [{ id: "i", projectName: "p", status: "DECLINED", dueDate: null, dueMinute: null }] });
    expect(buildJobGuide(facts, NOW).ask).not.toBeNull();
    expect(isOpenForGuide(facts)).toBe(false);
  });

  // ── THE SEND RECORD: an email the app sent for the invitation ──
  //
  // `sendBidProposal` marks the bid SUBMITTED too, so the status alone would
  // do — but the date lives only on the message, and a status set back by hand
  // must not un-send an email a GC received (facts.ts, "sent").
  it("an email the app sent counts as sent even while the status still reads INVITED, and the rail names the day", () => {
    const facts = ready({
      invitations: [{ id: "i", projectName: "p", status: "INVITED", dueDate: "2026-10-27", dueMinute: 600, proposalSentOn: "2026-10-26" }],
    });
    const guide = buildJobGuide(facts, NOW);
    expect(guide.ask).toBeNull();
    expect(guide.tone).toBe("working");
    expect(guide.dueLabel).toBeNull();
    expect(guide.steps.every((step) => step.status === "done")).toBe(true);
    expect(guide.steps[4]!.summary).toBe("Sent Oct 26");
    expect(needsYou([guide])).toEqual([]);
  });

  it("names the FIRST day it was sent when two GCs were emailed", () => {
    const facts = ready({
      invitations: [
        { id: "a", projectName: "p", status: "SUBMITTED", dueDate: null, dueMinute: null, proposalSentOn: "2026-10-24" },
        { id: "b", projectName: "p", status: "SUBMITTED", dueDate: null, dueMinute: null, proposalSentOn: "2026-10-22" },
      ],
    });
    expect(buildJobGuide(facts, NOW).steps[4]!.summary).toBe("Sent Oct 22");
  });

  it("a null or absent send record changes nothing: an INVITED bid that is ready still asks to be sent", () => {
    for (const proposalSentOn of [null, undefined]) {
      const facts = ready({
        invitations: [{ id: "i", projectName: "p", status: "INVITED", dueDate: "2026-10-27", dueMinute: 600, proposalSentOn }],
      });
      const guide = buildJobGuide(facts, NOW);
      expect(guide.ask?.id).toBe("send-due-soon");
      expect(needsYou([guide])).toHaveLength(1);
    }
  });

  it("drops off the home 'Needs you' list once sent", () => {
    const before = buildJobGuide(ready({ invitations: invited("2026-10-27") }), NOW);
    const after = buildJobGuide(
      ready({ invitations: invited("2026-10-27").map((one) => ({ ...one, status: "SUBMITTED" as const, proposalSentOn: "2026-10-26" })) }),
      NOW,
    );
    expect(needsYou([before, after])).toEqual([before]);
  });

  it("one GC sent and another still invited counts as sent", () => {
    const facts = ready({
      invitations: [
        { id: "a", projectName: "p", status: "SUBMITTED", dueDate: null, dueMinute: null },
        ...invited("2026-10-27"),
      ],
    });
    expect(buildJobGuide(facts, NOW).ask).toBeNull();
  });
});

describe("deadlines", () => {
  const dueLabel = (invitations: JobGuideFacts["invitations"], over: Partial<JobGuideFacts> = {}) =>
    buildJobGuide(ready({ invitations, ...over }), NOW).dueLabel;

  it("uses the earliest invitation still out", () => {
    expect(dueLabel([...invited("2026-10-30", 600), ...invited("2026-10-29", 840)])).toBe("due Thu 2:00 PM");
  });
  it("names the date beyond a week", () => {
    expect(dueLabel(invited("2026-11-12"))).toBe("due Nov 12");
  });
  it("falls back to the project's date, then the estimate's", () => {
    expect(dueLabel([], { project: { id: "p", name: "n", bidDueDate: "2026-10-28" } })).toBe("due Wed");
    expect(dueLabel([], { project: null, jobBidDueDate: "2026-10-30" })).toBe("due Fri");
  });
  it("is null when nobody recorded one", () => {
    expect(dueLabel([], { project: null, jobBidDueDate: null })).toBeNull();
  });
  it("sorts by the same instant", () => {
    expect(guideDueMs(ready())).toBe(Date.parse("2026-10-29T14:00:00.000Z"));
  });
});

describe("the words", () => {
  const manyUnpriced = ready({
    wallTypes: [w1, w2, { ...w2, code: "W3", wallTypeId: "x" }],
    linesWithoutPrice: 6,
    pastPriceSuggestions: [{ wallTypeCode: "W2", label: "a wall", fromJobName: "Civic Center", whenLabel: "in September" }],
  });
  const sentFacts = ready({ invitations: [{ id: "i", projectName: "p", status: "SUBMITTED", dueDate: null, dueMinute: null }] });
  const everyFacts = [
    ...Object.values(FIXTURES),
    manyUnpriced,
    sentFacts,
    // the contractor walk's stages: hand measurements, then typed lines, then a recap that cuts the bid
    walkTakeoff(),
    walkTakeoff({ lineCount: 3, bidTotal: 34_915 }),
    ready({ bidTotal: 34_915, recap: { appliedAt: null, addedTotal: 7_385, landsAt: 31_990.5 } }),
  ];

  const sentences = (guide: ReturnType<typeof buildJobGuide>): string[] =>
    [
      guide.headline,
      guide.oneLine,
      guide.dueLabel ?? "",
      guide.ask?.title ?? "",
      guide.ask?.body ?? "",
      ...(guide.ask?.actions.map((action) => action.label) ?? []),
      ...(guide.ask?.actions.map((action) => action.confirm ?? "") ?? []),
      ...guide.steps.map((step) => step.summary ?? ""),
    ].filter(Boolean);

  it("never shouts", () => {
    for (const facts of everyFacts) {
      for (const sentence of sentences(buildJobGuide(facts, NOW))) expect(sentence).not.toContain("!");
    }
  });

  it("every href starts with /bid", () => {
    let seen = 0;
    for (const facts of everyFacts) {
      for (const action of buildJobGuide(facts, NOW).ask?.actions ?? []) {
        if (action.href === undefined) continue;
        seen += 1;
        expect(action.href.startsWith("/bid/")).toBe(true);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(9); // a census over nothing passes everything
  });

  /** Every number a sentence may carry, formatted the way the engine formats it. */
  function allowedFigures(facts: JobGuideFacts): Set<string> {
    const figures = new Set<string>();
    for (const value of [
      facts.sheetCount,
      facts.sheetsRead,
      facts.sheetsMissingScale,
      facts.measuredFootageFt,
      facts.openingsCount,
      facts.lineCount,
      facts.linesWithoutPrice,
      facts.bidTotal,
      facts.recap?.addedTotal ?? 0,
      // what Apply writes, and how far that is from the lines now
      facts.recap?.landsAt ?? 0,
      facts.recap?.landsAt == null ? 0 : Math.abs(Math.round((facts.recap.landsAt - facts.bidTotal) * 100) / 100),
      // what was measured by hand
      facts.handMeasurements.count,
      facts.handMeasurements.lengthFt,
      facts.wallTypes.filter((type) => type.componentCount === 0 || type.unpricedLineCount > 0).length - 1, // "N more wall types"
      ...facts.wallTypes.map((type) => type.lengthFt),
      // the height question: its runs, their length, how many other types, and the offered answers
      ...facts.wallTypes.flatMap((type) => (type.heightless ? [type.heightless.runCount, type.heightless.lengthFt] : [])),
      facts.wallTypes.filter((type) => type.heightless).length - 1,
      ...WALL_HEIGHT_CHOICES,
      // the board-layer question: its runs, their length, how many other types, and the offered answers
      ...facts.wallTypes.flatMap((type) => (type.layersUnanswered ? [type.layersUnanswered.runCount, type.layersUnanswered.itemCount ?? 0, type.layersUnanswered.lengthFt] : [])),
      facts.wallTypes.filter((type) => type.layersUnanswered).length - 1,
      ...BOARD_LAYER_CHOICES,
      // the addenda: how many others are missing
      (facts.unacknowledgedAddenda ?? []).length - 1,
    ]) {
      figures.add(Math.round(value).toLocaleString("en-US"));
      figures.add(money(value));
    }
    for (const date of [facts.jobBidDueDate, facts.project?.bidDueDate, ...facts.invitations.map((invitation) => invitation.dueDate)]) {
      if (date) figures.add(String(Number(date.slice(8, 10)))); // day of month
    }
    for (const invitation of facts.invitations) {
      for (const minute of [invitation.dueMinute, invitation.walkMinute ?? null]) {
        if (minute === null) continue;
        const hh = Math.floor(minute / 60);
        figures.add(`${hh % 12 === 0 ? 12 : hh % 12}:${String(minute % 60).padStart(2, "0")}`);
      }
      for (const date of [invitation.walkDate, invitation.rfiCutoffDate]) if (date) figures.add(String(Number(date.slice(8, 10))));
    }
    for (const addendum of facts.unacknowledgedAddenda ?? []) {
      for (const digits of addendum.reference.match(/\d+/g) ?? []) figures.add(digits); // "Addendum 2" is its own label
      if (addendum.issuedOn) figures.add(String(Number(addendum.issuedOn.slice(8, 10))));
    }
    return figures;
  }

  it("carries no figure the facts do not hold", () => {
    let checked = 0;
    for (const facts of everyFacts) {
      const allowed = allowedFigures(facts);
      for (const sentence of sentences(buildJobGuide(facts, NOW))) {
        // Names such as W2 are labels, not figures.
        const stripped = sentence.replace(/\b[A-Z]+\d+\b/g, "");
        for (const match of stripped.match(/\$[\d,]+(?:\.\d+)?|\d{1,2}:\d{2}|\d[\d,]*/g) ?? []) {
          checked += 1;
          expect(allowed, `"${match}" in "${sentence}"`).toContain(match);
        }
      }
    }
    expect(checked).toBeGreaterThan(30); // a check over no figures passes everything
  });

  it("the check can fail: a figure not in the facts is caught", () => {
    const allowed = allowedFigures(ready());
    expect(allowed.has("777")).toBe(false);
    expect(allowed.has("1,240")).toBe(true);
  });

  it("formats money with the app's own formatter", () => {
    expect(buildJobGuide(FIXTURES["proposal-ready"], NOW).ask!.title).toContain(money(412_300.5));
    expect(money(412_300.5)).toBe("$412,300.50");
  });

  it("does not move when the clock does, when no deadline is involved", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(buildJobGuide(FIXTURES["unpriced-wall-types"], later)).toEqual(buildJobGuide(FIXTURES["unpriced-wall-types"], NOW));
  });
});

describe("the home list order", () => {
  const named = (name: string, jobId: string, over: Partial<JobGuideFacts> = {}) => ready({ name, jobId, ...over });

  it("asks first by deadline, then ready to send, then working", () => {
    const order = buildGuidesFromFacts(
      [
        named("Sent bid", "sent", {
          invitations: [{ id: "s", projectName: "p", status: "SUBMITTED", dueDate: "2026-10-27", dueMinute: null }],
        }),
        named("Ready, due Thu", "ready", { invitations: invited("2026-10-29", 600) }),
        named("Unpriced, due Fri", "fri", { invitations: invited("2026-10-30", 600), linesWithoutPrice: 1 }),
        named("Unpriced, due Wed", "wed", { invitations: invited("2026-10-28", 600), linesWithoutPrice: 1 }),
        named("Unpriced, no date", "undated", { invitations: [], project: null, linesWithoutPrice: 1 }),
      ],
      NOW,
    ).map((guide) => guide.jobId);
    expect(order).toEqual(["wed", "fri", "undated", "ready", "sent"]);
  });

  it("is stable on ties, by name", () => {
    const order = buildGuidesFromFacts(
      [named("Bravo", "b", { linesWithoutPrice: 1 }), named("Alpha", "a", { linesWithoutPrice: 1 })],
      NOW,
    );
    expect(order.map((guide) => guide.name)).toEqual(["Alpha", "Bravo"]);
  });
});

// THE WALK OF 2026-10-30: Turner's proposal (−5%, $30,403.80) carried a card
// reading "ready to open at $32,004.00 … send it to Halvorsen Builders".
describe("the ready ask for one GC's proposal", () => {
  const twoGcs = () =>
    ready({
      gcName: "Halvorsen Builders",
      bidTotal: 32_004,
      invitations: [
        { id: "inv_h", projectName: "p", status: "INVITED", dueDate: "2026-11-05", dueMinute: 840, gcName: "Halvorsen Builders" },
        {
          id: "inv_t",
          projectName: "p",
          status: "INVITED",
          dueDate: "2026-11-05",
          dueMinute: 840,
          gcName: "Turner",
          priceAdjust: { amount: null, percent: -5 },
        },
      ],
    });

  it("names that GC and that GC's adjusted price, and opens that GC's proposal", () => {
    const guide = buildJobGuide(twoGcs(), NOW);
    expect(guide.ask!.id).toBe("proposal-ready");
    const turner = guide.askByInvitation!["inv_t"]!;
    expect(turner.title).toBe("The proposal is ready to open at $30,403.80.");
    expect(turner.body).toContain("send it to Turner.");
    expect(turner.body).not.toContain("Halvorsen");
    expect(turner.actions[0]).toMatchObject({ href: "/bid/estimates/job_1/proposal?invitation=inv_t", primary: true });
    expect(guide.askByInvitation!["inv_h"]!.title).toBe("The proposal is ready to open at $32,004.00.");
  });

  it("an adjustment that cannot be applied gets no figure", () => {
    const facts = twoGcs();
    facts.invitations[1]!.priceAdjust = { amount: -40_000, percent: null };
    const turner = buildJobGuide(facts, NOW).askByInvitation!["inv_t"]!;
    expect(turner.title).toBe("The proposal for Turner can't go out at this price.");
    expect(turner.title + (turner.body ?? "")).not.toMatch(/\$\d/);
  });

  it("only the ready ask has per-GC wording", () => {
    expect(buildJobGuide({ ...twoGcs(), linesWithoutPrice: 1 }, NOW).askByInvitation).toBeUndefined();
  });
});

// THE WALK OF 2026-10-30: no rates, and the card still offered "Apply the
// recap", which would have priced every line at its bare cost.
describe("a recap that adds nothing", () => {
  it("is not offered", () => {
    const guide = buildJobGuide(ready({ recap: { appliedAt: null, addedTotal: 0, landsAt: 22_440 } }), NOW);
    expect(guide.ask!.id).not.toBe("apply-recap");
  });
});
