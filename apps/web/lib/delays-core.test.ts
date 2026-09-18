import { describe, expect, it } from "vitest";
import { DelayInputError, formatMinutes, parseDelay, parseTimeOfDay } from "./delays-core";

const base = { date: "2026-09-17", cause: "MATERIAL", responsibleParty: "SUPPLIER", description: "Studs never showed" };

describe("a structured delay", () => {
  it("needs a real day, a cause, who caused it and what happened", () => {
    expect(() => parseDelay({ ...base, date: "2026-02-30" })).toThrow(DelayInputError);
    expect(() => parseDelay({ ...base, cause: "" })).toThrow(/cause/);
    expect(() => parseDelay({ ...base, cause: "ALIENS" })).toThrow(/choices/);
    expect(() => parseDelay({ ...base, responsibleParty: "" })).toThrow(/who caused it/);
    expect(() => parseDelay({ ...base, description: " " })).toThrow(/what happened/);
  });

  it("works out crew-hours lost from workers and times when it is left blank", () => {
    const d = parseDelay({ ...base, workersAffected: "4", startTime: "7:00", endTime: "10:30" });
    expect(d).toMatchObject({ startMinute: 420, endMinute: 630, workersAffected: 4, hoursLost: "14.00" });
    expect(parseDelay({ ...base, workersAffected: "4", startTime: "7", endTime: "10", hoursLost: "6" }).hoursLost).toBe("6.00");
    expect(() => parseDelay({ ...base, startTime: "10:00", endTime: "9:00" })).toThrow(/end after/);
  });

  it("records who at the GC was told only with a method, stamping now when no time is given", () => {
    const now = new Date("2026-09-17T18:00:00Z");
    expect(parseDelay({ ...base, gcNotifiedWho: "Sam" }, now)).toMatchObject({ gcNotifiedHow: null, gcNotifiedWho: null, gcNotifiedAt: null });
    expect(parseDelay({ ...base, gcNotifiedHow: "PHONE", gcNotifiedWho: "Sam (super)" }, now)).toMatchObject({
      gcNotifiedHow: "PHONE",
      gcNotifiedWho: "Sam (super)",
      gcNotifiedAt: now,
    });
  });

  it("reads times the way people type them", () => {
    expect(parseTimeOfDay("7:30", "t")).toBe(450);
    expect(parseTimeOfDay("1pm", "t")).toBe(780);
    expect(parseTimeOfDay("12am", "t")).toBe(0);
    expect(parseTimeOfDay("", "t")).toBeNull();
    expect(() => parseTimeOfDay("25:00", "Start")).toThrow(/Start/);
    expect(formatMinutes(450)).toBe("7:30 am");
    expect(formatMinutes(780)).toBe("1:00 pm");
  });
});
