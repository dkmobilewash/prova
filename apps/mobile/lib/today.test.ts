import { describe, expect, it } from "vitest";
import { formatHours, summariseToday } from "./today";
import type { FieldReportRow, Media, PunchListItem, TimeEntry } from "./types";

/**
 * The Home tab's sentences.
 *
 * A home screen earns its place only if it can be WRONG — "today's report
 * isn't filed" is a claim about the day, "Field reports ›" is a menu. So
 * every line is derived here and asserted here, against the shapes the API
 * really returns.
 */

const now = new Date("2026-09-20T15:00:00.000Z");

const report = (reportDate: string): FieldReportRow =>
  ({ id: reportDate, jobId: "job_1", reportDate, workPerformed: "framing" }) as FieldReportRow;

const punch = (status: PunchListItem["status"]): PunchListItem =>
  ({ id: `p-${status}-${Math.random()}`, description: "x", status }) as PunchListItem;

const photo = (capturedAt: string): Media => ({ id: capturedAt, capturedAt }) as Media;

const entry = (date: string, hours: string, employeeName: string): TimeEntry =>
  ({ id: `${date}-${employeeName}-${hours}`, date, hours, employeeName }) as TimeEntry;

const base = { reports: [], punchItems: [], media: [], timeEntries: [], pending: 0, now };

describe("what the day looks like", () => {
  it("leads with anything still unsent, because that is what can still be lost", () => {
    const [first] = summariseToday({ ...base, pending: 2 });
    expect(first).toMatchObject({ key: "pending", label: "2 changes still to send", tone: "warn" });
    expect(summariseToday({ ...base, pending: 1 })[0].label).toBe("1 change still to send");
  });

  it("says nothing about syncing when there is nothing waiting", () => {
    expect(summariseToday(base).some((line) => line.key === "pending")).toBe(false);
  });

  it("knows whether today's report is filed, by report date and not by when it was typed", () => {
    expect(line(summariseToday({ ...base, reports: [report("2026-09-19")] }), "report")).toMatchObject({
      label: "Today's report isn't filed",
      tone: "todo",
    });
    expect(line(summariseToday({ ...base, reports: [report("2026-09-20")] }), "report")).toMatchObject({
      label: "Today's report is filed",
      tone: "done",
    });
  });

  it("adds up today's hours and counts the people, ignoring other days", () => {
    const entries = [
      entry("2026-09-20", "8", "Mike"),
      entry("2026-09-20", "4.5", "Ana"),
      entry("2026-09-19", "8", "Mike"),
    ];
    expect(line(summariseToday({ ...base, timeEntries: entries }), "time").label).toBe(
      "12.5 hours logged today, 2 people",
    );
  });

  it("counts a person once however many entries they logged", () => {
    const entries = [entry("2026-09-20", "4", "Mike"), entry("2026-09-20", "4", "Mike")];
    expect(line(summariseToday({ ...base, timeEntries: entries }), "time").label).toBe(
      "8 hours logged today, 1 person",
    );
  });

  it("splits punch items into what is open and what is waiting on somebody", () => {
    const items = [punch("OPEN"), punch("OPEN"), punch("READY_FOR_REVIEW"), punch("VERIFIED")];
    expect(line(summariseToday({ ...base, punchItems: items }), "punch").label).toBe(
      "2 punch items open, 1 waiting to be verified",
    );
  });

  it("says the list is clear only when there IS a list", () => {
    // No punch items at all is not an achievement, and a screen that
    // congratulates you for a job nobody has walked is lying quietly.
    expect(summariseToday(base).some((l) => l.key === "punch")).toBe(false);
    expect(line(summariseToday({ ...base, punchItems: [punch("VERIFIED")] }), "punch")).toMatchObject({
      label: "Punch list is clear",
      tone: "done",
    });
  });

  it("counts today's photos only", () => {
    const media = [photo("2026-09-20T09:00:00.000Z"), photo("2026-09-20T11:00:00.000Z"), photo("2026-09-18T09:00:00.000Z")];
    expect(line(summariseToday({ ...base, media }), "photos").label).toBe("2 photos today");
    expect(line(summariseToday(base), "photos")).toMatchObject({ label: "No photos today", tone: "todo" });
  });

  it("points every line at the section it is about", () => {
    const lines = summariseToday({ ...base, punchItems: [punch("OPEN")] });
    expect(lines.every((l) => l.section)).toBe(true);
  });
});

describe("hours, read at arm's length", () => {
  it("drops a trailing zero and gets the plural right", () => {
    expect(formatHours(8)).toBe("8 hours");
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(7.5)).toBe("7.5 hours");
    expect(formatHours(0)).toBe("0 hours");
  });
});

function line(lines: ReturnType<typeof summariseToday>, key: string) {
  const found = lines.find((l) => l.key === key);
  if (!found) throw new Error(`no line for ${key}`);
  return found;
}
