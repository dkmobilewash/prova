import { describe, expect, it } from "vitest";
import { buildJobGuide, DUE_SOON_HOURS, guideDueMs } from "./buildJobGuide";
import { buildGuidesFromFacts } from "./index";
import { isOpenForGuide, type GuideWallTypeFact, type JobGuideFacts } from "./facts";
import { GUIDE_STEP_KEYS, type GuideStepStatus } from "./types";
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
    ...over,
  };
}

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

const statuses = (facts: JobGuideFacts): GuideStepStatus[] => buildJobGuide(facts, NOW).steps.map((step) => step.status);

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
  "apply-recap": ready({ recap: { appliedAt: null, addedTotal: 38_250.75 } }),
  "proposal-ready": ready(),
  "send-due-soon": ready({ invitations: invited("2026-10-27", 840) }),
} satisfies Record<string, JobGuideFacts>;

describe("one fixture per ask", () => {
  for (const [id, facts] of Object.entries(FIXTURES)) {
    it(`${id} fires, on its own step, with one primary action`, () => {
      const guide = buildJobGuide(facts, NOW);
      expect(guide.ask?.id).toBe(id);
      expect(guide.ask!.actions.filter((action) => action.primary).length).toBe(1);
      for (const action of guide.ask!.actions) {
        expect(Boolean(action.href) !== Boolean(action.actionId)).toBe(true); // exactly one of the two
      }
      const current = guide.steps.filter((step) => step.status === "current");
      expect(current.map((step) => step.key)).toEqual([guide.ask!.step]);
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

  it("apply-recap names the action, carries the job id, and says what it adds", () => {
    const ask = buildJobGuide(FIXTURES["apply-recap"], NOW).ask!;
    expect(ask.actions[0]).toEqual({ label: "Apply the recap", actionId: "applyRecap", actionArg: "job_1", primary: true });
    expect(ask.body).toBe(`Applying it adds ${money(38_250.75)} to the bid.`);
    expect(ask.actions[1]).toMatchObject({ href: "/bid/estimates/job_1/recap" });
  });

  it("an applied recap asks for nothing", () => {
    const facts = ready({ recap: { appliedAt: "2026-10-25", addedTotal: 100 } });
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

describe("priority: the earliest missing step wins", () => {
  it("no drawings beats everything", () => {
    expect(buildJobGuide(empty({ recap: { appliedAt: null, addedTotal: 5 }, linesWithoutPrice: 2 }), NOW).ask!.id).toBe("no-drawings");
  });
  it("no scale beats unmeasured walls", () => {
    expect(buildJobGuide(FIXTURES["no-scale"], NOW).ask!.id).toBe("no-scale");
    expect(buildJobGuide({ ...FIXTURES["no-scale"], sheetsMissingScale: 0 }, NOW).ask!.id).toBe("no-walls-measured");
  });
  it("walls not in the estimate beat unpriced wall types", () => {
    const facts = { ...FIXTURES["walls-not-added"], linesWithoutPrice: 1, recap: { appliedAt: null, addedTotal: 1 } };
    expect(buildJobGuide(facts, NOW).ask!.id).toBe("walls-not-added");
  });
  it("unpriced wall types beat unpriced lines, which beat the recap, which beats the proposal", () => {
    const base = ready({ wallTypes: [w2], linesWithoutPrice: 3, recap: { appliedAt: null, addedTotal: 1 } });
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

describe("the rail", () => {
  it("done, current, todo in order, for each stage", () => {
    const by = (id: keyof typeof FIXTURES): GuideStepStatus[] => statuses(FIXTURES[id]);
    expect(by("no-drawings")).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(by("no-scale")).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(by("unpriced-wall-types")).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(by("apply-recap")).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(by("proposal-ready")).toEqual(["done", "done", "done", "current", "todo"]);
    expect(by("send-due-soon")).toEqual(["done", "done", "done", "done", "current"]);
    expect(statuses(empty({ invitations: [], project: null }))).toEqual(["current", "todo", "todo", "todo", "todo"]);
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
      recap: { appliedAt: null, addedTotal: 9 },
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
  const everyFacts = [...Object.values(FIXTURES), manyUnpriced, sentFacts];

  const sentences = (guide: ReturnType<typeof buildJobGuide>): string[] =>
    [
      guide.headline,
      guide.oneLine,
      guide.dueLabel ?? "",
      guide.ask?.title ?? "",
      guide.ask?.body ?? "",
      ...(guide.ask?.actions.map((action) => action.label) ?? []),
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
      facts.wallTypes.filter((type) => type.componentCount === 0 || type.unpricedLineCount > 0).length - 1, // "N more wall types"
      ...facts.wallTypes.map((type) => type.lengthFt),
    ]) {
      figures.add(Math.round(value).toLocaleString("en-US"));
      figures.add(money(value));
    }
    for (const date of [facts.jobBidDueDate, facts.project?.bidDueDate, ...facts.invitations.map((invitation) => invitation.dueDate)]) {
      if (date) figures.add(String(Number(date.slice(8, 10)))); // day of month
    }
    for (const invitation of facts.invitations) {
      if (invitation.dueMinute !== null) {
        const hh = Math.floor(invitation.dueMinute / 60);
        figures.add(`${hh % 12 === 0 ? 12 : hh % 12}:${String(invitation.dueMinute % 60).padStart(2, "0")}`);
      }
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
