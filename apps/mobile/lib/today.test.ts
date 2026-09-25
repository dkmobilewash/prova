import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatHours, summariseToday, todayKey } from "./today";
import type { FieldReportRow, Media, PunchListItem, TimeEntry } from "./types";

/**
 * The Home tab's sentences.
 *
 * A home screen earns its place only if it can be WRONG — "today's report
 * isn't filed" is a claim about the day, "Field reports ›" is a menu. So
 * every line is derived here and asserted here, against the shapes the API
 * really returns.
 *
 * WHAT THIS FILE ASSERTS CHANGED WITH THE SPANISH PASS, and it is a better
 * test than it was. A line no longer carries a finished English sentence;
 * it carries the KEY of the sentence and the numbers that fill it. So
 * these assertions pin the BRANCH that was chosen — which of four "hours
 * logged" sentences, which arm of a plural — and stop caring how it is
 * worded, in either language. Rewording "Punch list is clear" used to be a
 * test failure; picking the plural arm for a single photo still is.
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
    expect(first).toMatchObject({
      key: "pending",
      label: "today.pending.many",
      vars: { count: 2 },
      tone: "warn",
    });
    expect(summariseToday({ ...base, pending: 1 })[0]).toMatchObject({
      label: "today.pending.one",
      vars: { count: 1 },
    });
  });

  it("says nothing about syncing when there is nothing waiting", () => {
    expect(summariseToday(base).some((line) => line.key === "pending")).toBe(false);
  });

  it("knows whether today's report is filed, by report date and not by when it was typed", () => {
    expect(line(summariseToday({ ...base, reports: [report("2026-09-19")] }), "report")).toMatchObject({
      label: "today.report.notFiled",
      tone: "todo",
    });
    expect(line(summariseToday({ ...base, reports: [report("2026-09-20")] }), "report")).toMatchObject({
      label: "today.report.filed",
      tone: "done",
    });
  });

  it("adds up today's hours and counts the people, ignoring other days", () => {
    const entries = [
      entry("2026-09-20", "8", "Mike"),
      entry("2026-09-20", "4.5", "Ana"),
      entry("2026-09-19", "8", "Mike"),
    ];
    expect(line(summariseToday({ ...base, timeEntries: entries }), "time")).toMatchObject({
      label: "today.time.hours.manyPeople",
      vars: { hours: "12.5", people: 2 },
    });
  });

  it("counts a person once however many entries they logged", () => {
    const entries = [entry("2026-09-20", "4", "Mike"), entry("2026-09-20", "4", "Mike")];
    expect(line(summariseToday({ ...base, timeEntries: entries }), "time")).toMatchObject({
      label: "today.time.hours.onePerson",
      vars: { hours: "8", people: 1 },
    });
  });

  it("says nothing was logged when nobody logged anything", () => {
    expect(line(summariseToday(base), "time")).toMatchObject({
      label: "today.time.none",
      tone: "todo",
    });
  });

  it("picks the singular hour and the singular person separately", () => {
    // Both plurals move independently, which is the whole reason there are
    // four sentences rather than two: one person can log one hour, and two
    // people can log one hour between them.
    expect(
      line(summariseToday({ ...base, timeEntries: [entry("2026-09-20", "1", "Mike")] }), "time"),
    ).toMatchObject({ label: "today.time.hour.onePerson", vars: { hours: "1", people: 1 } });

    const halves = [entry("2026-09-20", "0.5", "Mike"), entry("2026-09-20", "0.5", "Ana")];
    expect(line(summariseToday({ ...base, timeEntries: halves }), "time")).toMatchObject({
      label: "today.time.hour.manyPeople",
      vars: { hours: "1", people: 2 },
    });
  });

  it("splits punch items into what is open and what is waiting on somebody", () => {
    const items = [punch("OPEN"), punch("OPEN"), punch("READY_FOR_REVIEW"), punch("VERIFIED")];
    expect(line(summariseToday({ ...base, punchItems: items }), "punch")).toMatchObject({
      label: "today.punch.openAndWaiting.many",
      vars: { open: 2, waiting: 1 },
    });
  });

  it("says only the half that is true when only one half is", () => {
    expect(
      line(summariseToday({ ...base, punchItems: [punch("OPEN")] }), "punch"),
    ).toMatchObject({ label: "today.punch.open.one", vars: { open: 1, waiting: 0 }, tone: "todo" });

    expect(
      line(summariseToday({ ...base, punchItems: [punch("OPEN"), punch("OPEN")] }), "punch"),
    ).toMatchObject({ label: "today.punch.open.many", vars: { open: 2 } });

    // Nothing open, something waiting: the line is context, not a chore.
    expect(
      line(summariseToday({ ...base, punchItems: [punch("READY_FOR_REVIEW")] }), "punch"),
    ).toMatchObject({ label: "today.punch.waiting", vars: { waiting: 1 }, tone: "plain" });

    expect(
      line(
        summariseToday({ ...base, punchItems: [punch("OPEN"), punch("READY_FOR_REVIEW")] }),
        "punch",
      ),
    ).toMatchObject({ label: "today.punch.openAndWaiting.one", vars: { open: 1, waiting: 1 } });
  });

  it("says the list is clear only when there IS a list", () => {
    // No punch items at all is not an achievement, and a screen that
    // congratulates you for a job nobody has walked is lying quietly.
    expect(summariseToday(base).some((l) => l.key === "punch")).toBe(false);
    expect(line(summariseToday({ ...base, punchItems: [punch("VERIFIED")] }), "punch")).toMatchObject({
      label: "today.punch.clear",
      tone: "done",
    });
  });

  it("counts today's photos only", () => {
    const media = [photo("2026-09-20T09:00:00.000Z"), photo("2026-09-20T11:00:00.000Z"), photo("2026-09-18T09:00:00.000Z")];
    expect(line(summariseToday({ ...base, media }), "photos")).toMatchObject({
      label: "today.photos.many",
      vars: { count: 2 },
    });
    expect(line(summariseToday({ ...base, media: [photo("2026-09-20T09:00:00.000Z")] }), "photos")).toMatchObject({
      label: "today.photos.one",
      vars: { count: 1 },
    });
    expect(line(summariseToday(base), "photos")).toMatchObject({
      label: "today.photos.none",
      tone: "todo",
    });
  });

  it("points every line at the section it is about", () => {
    const lines = summariseToday({ ...base, punchItems: [punch("OPEN")] });
    expect(lines.every((l) => l.section)).toBe(true);
  });

  it("hands Home a key for every line and never a sentence", () => {
    // The guard on the shape itself: a key has no spaces and lives under
    // `today.`, a finished sentence has both. Written against a day with
    // every line on it, and the count is asserted so a summary that
    // returned nothing could not pass this vacuously.
    const lines = summariseToday({
      ...base,
      pending: 3,
      reports: [report("2026-09-20")],
      punchItems: [punch("OPEN"), punch("READY_FOR_REVIEW")],
      media: [photo("2026-09-20T09:00:00.000Z")],
      timeEntries: [entry("2026-09-20", "8", "Mike")],
    });
    expect(lines).toHaveLength(5);
    for (const l of lines) {
      expect(l.label).toMatch(/^today\.[a-zA-Z.]+$/);
    }
  });
});

describe("hours, read at arm's length", () => {
  it("drops a trailing zero and leaves the unit to the sentence", () => {
    // "hour" vs "hours" is no longer this function's business — it is the
    // key `summariseToday` picks, asserted above — so what is left here is
    // the number, which still has to read cleanly on a phone at arm's
    // length.
    expect(formatHours(8)).toBe("8");
    expect(formatHours(1)).toBe("1");
    expect(formatHours(7.5)).toBe("7.5");
    expect(formatHours(0)).toBe("0");
  });

  it("rounds to the same number the plural arm is chosen from", () => {
    // 0.999 prints as "1" and must not print as "1" beside "hours".
    expect(formatHours(0.999)).toBe("1");
    expect(
      line(
        summariseToday({ ...base, timeEntries: [entry("2026-09-20", "0.999", "Mike")] }),
        "time",
      ),
    ).toMatchObject({ label: "today.time.hour.onePerson", vars: { hours: "1" } });
  });
});

function line(lines: ReturnType<typeof summariseToday>, key: string) {
  const found = lines.find((l) => l.key === key);
  if (!found) throw new Error(`no line for ${key}`);
  return found;
}

/**
 * WHICH DAY "TODAY" IS, and the six hours that made Home lie.
 *
 * `todayKey` used to be `now.toISOString().slice(0, 10)` — the UTC day.
 * After 18:00 in Albuquerque that is already tomorrow, so Home printed
 * the phone's date over lines counted against the next one, and
 * `time/[jobId]` asked for hours on a day the crew had not worked yet.
 * It is the same bug `lib/local-today.ts` was written for on the
 * schedule screen, at a second site.
 *
 * THE TIMEZONE IS FORCED, and asserted, because this case is VACUOUS in
 * UTC: there the two spellings agree and a reverted `todayKey` would
 * pass. CI runs in UTC. So the first expectation is that the clock
 * really did move — without it this test proves nothing and would say
 * nothing about it.
 */
describe("the day the phone is on", () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Denver";
  });
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("is running somewhere the two spellings of today DISAGREE", () => {
    const evening = new Date("2026-09-24T00:03:00Z");
    expect(
      evening.getTimezoneOffset(),
      "TZ did not take effect — this whole describe is vacuous, because UTC cannot tell the two apart",
    ).toBeGreaterThan(0);
    expect(evening.toISOString().slice(0, 10)).toBe("2026-09-24");
  });

  it("takes the phone's calendar day, not UTC's", () => {
    // 18:03 Mountain on the 23rd. UTC already says the 24th.
    expect(todayKey(new Date("2026-09-24T00:03:00Z"))).toBe("2026-09-23");
  });

  it("counts the day's rows against that same day", () => {
    const evening = new Date("2026-09-24T00:03:00Z");
    const lines = summariseToday({
      reports: [],
      punchItems: [],
      media: [{ capturedAt: "2026-09-23T22:00:00.000Z" } as Media],
      timeEntries: [],
      pending: 0,
      now: evening,
    });
    // On the UTC spelling this photo belonged to "yesterday" and the line
    // read "No photos today" under a date that said the 23rd.
    expect(line(lines, "photos").label).toBe("today.photos.one");
  });
});
