import { describe, expect, it } from "vitest";

import {
  currentStageSince,
  daysInCurrentStage,
  historyDisagrees,
  inOrder,
  isFutureDated,
  latestChange,
  stageSpells,
  stageTiming,
  type OpportunityStage,
  type RecordedStageChange,
} from "./sales-stage-history";

function change(
  id: string,
  fromStage: OpportunityStage | null,
  toStage: OpportunityStage,
  effectiveOn: string,
  recordedAt?: string,
): RecordedStageChange {
  return {
    id,
    fromStage,
    toStage,
    effectiveOn,
    note: null,
    recordedAt: recordedAt ?? `${effectiveOn}T12:00:00.000Z`,
  };
}

const TODAY = "2026-09-04";

describe("currentStageSince", () => {
  it("is null when nothing is recorded — not a date, not zero", () => {
    expect(currentStageSince([])).toBeNull();
  });

  it("takes the latest move regardless of the order given", () => {
    const history = [
      change("c", "TRIAL", "WON", "2026-08-20"),
      change("a", null, "NEW", "2026-06-01"),
      change("b", "NEW", "TRIAL", "2026-07-15"),
    ];
    expect(currentStageSince(history)).toBe("2026-08-20");
    expect(currentStageSince([...history].reverse())).toBe("2026-08-20");
  });

  it("breaks a same-day tie on the moment the row was written", () => {
    const first = change("first", "NEW", "CONTACTED", "2026-09-01", "2026-09-01T09:00:00.000Z");
    const second = change("second", "CONTACTED", "TRIAL", "2026-09-01", "2026-09-01T17:00:00.000Z");
    expect(latestChange([first, second])?.id).toBe("second");
    expect(latestChange([second, first])?.id).toBe("second");
  });
});

describe("inOrder", () => {
  it("does not mutate the array it was given", () => {
    const history = [change("b", "NEW", "TRIAL", "2026-07-15"), change("a", null, "NEW", "2026-06-01")];
    inOrder(history);
    expect(history.map((h) => h.id)).toEqual(["b", "a"]);
  });
});

describe("daysInCurrentStage", () => {
  it("is null when nothing is recorded", () => {
    expect(daysInCurrentStage([], TODAY)).toBeNull();
  });

  it("is 0 — a real answer — when the deal moved today", () => {
    // 0 and null must not be the same value: one means "moved today", the
    // other means "nobody wrote anything down".
    expect(daysInCurrentStage([change("a", "NEW", "TRIAL", TODAY)], TODAY)).toBe(0);
    expect(daysInCurrentStage([], TODAY)).toBeNull();
  });

  it("counts whole days since the latest move", () => {
    const history = [
      change("a", null, "NEW", "2026-06-01"),
      change("b", "NEW", "DEMO_SCHEDULED", "2026-08-25"),
    ];
    expect(daysInCurrentStage(history, TODAY)).toBe(10);
  });

  it("is null, never negative, when the move is dated in the future", () => {
    // The failure this pins: a deal recorded as moving next Tuesday would
    // otherwise read "-4 days in Trial", which is worse than saying
    // nothing at all.
    const history = [change("a", "NEW", "TRIAL", "2026-09-08")];
    expect(daysInCurrentStage(history, TODAY)).toBeNull();
    expect(isFutureDated(history, TODAY)).toBe(true);
  });

  it("does not call a move dated today future-dated", () => {
    expect(isFutureDated([change("a", "NEW", "TRIAL", TODAY)], TODAY)).toBe(false);
  });
});

describe("historyDisagrees", () => {
  it("is false when there is no history — silence is not disagreement", () => {
    expect(historyDisagrees([], "TRIAL")).toBe(false);
  });

  it("is false when the latest move lands on the stored stage", () => {
    const history = [change("a", null, "NEW", "2026-06-01"), change("b", "NEW", "TRIAL", "2026-07-01")];
    expect(historyDisagrees(history, "TRIAL")).toBe(false);
  });

  it("is true when the stored stage is not where the history left the deal", () => {
    const history = [change("a", null, "NEW", "2026-06-01"), change("b", "NEW", "TRIAL", "2026-07-01")];
    expect(historyDisagrees(history, "WON")).toBe(true);
  });

  it("reads the LATEST move, not any move", () => {
    // A deal that passed through WON and was reopened into TRIAL does not
    // "agree" with a stored stage of WON.
    const history = [
      change("a", null, "NEW", "2026-06-01"),
      change("b", "NEW", "WON", "2026-07-01"),
      change("c", "WON", "TRIAL", "2026-08-01"),
    ];
    expect(historyDisagrees(history, "WON")).toBe(true);
    expect(historyDisagrees(history, "TRIAL")).toBe(false);
  });
});

describe("stageSpells", () => {
  it("is empty when nothing is recorded", () => {
    expect(stageSpells([], TODAY)).toEqual([]);
  });

  it("measures each stretch from its own move to the next", () => {
    const history = [
      change("a", null, "NEW", "2026-08-01"),
      change("b", "NEW", "DEMO_SCHEDULED", "2026-08-11"),
      change("c", "DEMO_SCHEDULED", "TRIAL", "2026-08-30"),
    ];
    const spells = stageSpells(history, TODAY);
    expect(spells.map((s) => [s.stage, s.days, s.isCurrent])).toEqual([
      ["NEW", 10, false],
      ["DEMO_SCHEDULED", 19, false],
      ["TRIAL", 5, true],
    ]);
    expect(spells[0].leftOn).toBe("2026-08-11");
    expect(spells[2].leftOn).toBeNull();
  });

  it("keeps a revisited stage as two separate stretches, never summed", () => {
    // The failure this pins: condensing per stage would report "18 days in
    // Trial" and hide entirely that the deal was written off in between.
    const history = [
      change("a", null, "TRIAL", "2026-08-01"),
      change("b", "TRIAL", "LOST", "2026-08-11"),
      change("c", "LOST", "TRIAL", "2026-08-26"),
    ];
    const spells = stageSpells(history, TODAY);
    expect(spells.map((s) => s.stage)).toEqual(["TRIAL", "LOST", "TRIAL"]);
    expect(spells.map((s) => s.days)).toEqual([10, 15, 9]);
    expect(spells.filter((s) => s.isCurrent)).toHaveLength(1);
  });

  it("marks exactly one spell current, and it is the last", () => {
    const history = [
      change("a", null, "NEW", "2026-08-01"),
      change("b", "NEW", "TRIAL", "2026-08-20"),
    ];
    const spells = stageSpells(history, TODAY);
    expect(spells.filter((s) => s.isCurrent).map((s) => s.stage)).toEqual(["TRIAL"]);
  });

  it("gives a future-dated current spell null days rather than a negative", () => {
    const spells = stageSpells([change("a", "NEW", "TRIAL", "2026-09-08")], TODAY);
    expect(spells[0].days).toBeNull();
  });

  it("orders by the day it happened, not by the order given", () => {
    const history = [
      change("b", "NEW", "TRIAL", "2026-08-20"),
      change("a", null, "NEW", "2026-08-01"),
    ];
    expect(stageSpells(history, TODAY).map((s) => s.stage)).toEqual(["NEW", "TRIAL"]);
  });
});

describe("stageTiming", () => {
  it("says 'not recorded' for null rather than inventing a zero", () => {
    expect(stageTiming(null)).toBe("not recorded");
  });

  it("distinguishes today from one day", () => {
    expect(stageTiming(0)).toBe("today");
    expect(stageTiming(1)).toBe("1 day");
    expect(stageTiming(2)).toBe("2 days");
  });
});
