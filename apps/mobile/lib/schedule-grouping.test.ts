import { describe, expect, it } from "vitest";
import { groupByDay } from "./schedule-days";
import type { ScheduleRow } from "./types";

/** The shape the schedule screen reads: days in order, people in order. */

const row = (workDate: string, workerName: string, hoursLogged: boolean | null = null): ScheduleRow => ({
  id: `${workDate}-${workerName}`,
  workDate,
  workerName,
  workerKind: "crew",
  workerId: workerName,
  craftLabel: null,
  hoursLogged,
});

describe("grouping the schedule", () => {
  it("puts days in date order and people in name order", async () => {
    const days = groupByDay([
      row("2026-02-03", "Zoe"),
      row("2026-02-02", "Mike"),
      row("2026-02-03", "Ana"),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-02-02", "2026-02-03"]);
    expect(days[1].people.map((p) => p.workerName)).toEqual(["Ana", "Zoe"]);
  });

  it("keeps a day with one person", () => {
    expect(groupByDay([row("2026-02-02", "Mike")])).toEqual([
      { date: "2026-02-02", people: [row("2026-02-02", "Mike")] },
    ]);
  });

  it("is empty for nothing scheduled", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("carries the missing-timecard flag through untouched", () => {
    // The screen's whole reason for showing the past.
    const days = groupByDay([row("2026-02-02", "Mike", false), row("2026-02-02", "Ana", true)]);
    expect(days[0].people.map((p) => p.hoursLogged)).toEqual([true, false]);
  });
});
