import { describe, expect, it } from "vitest";
import {
  byDay,
  byDoor,
  coldIsDead,
  dayOf,
  doorFromSubject,
  eventSubject,
  filesReceivedDoor,
  filesReceivedSummary,
  per100,
  slackSummary,
  tally,
  todayBoard,
  windowDays,
  type ActivityRecord,
  type EventRecord,
  type ReplyRecord,
} from "./outbound-scoreboard";

describe("doorFromSubject", () => {
  it("reads the three sequence subjects, with and without reply prefixes", () => {
    expect(doorFromSubject("Baker Drywall pay app")).toBe("PAY_APP");
    expect(doorFromSubject("Re: Mission Valley HS certified payroll")).toBe("CERTIFIED_PAYROLL");
    expect(doorFromSubject("RE: Baker Drywall next bid")).toBe("TAKEOFF");
  });
  it("is UNKNOWN for anything else, including nothing", () => {
    expect(doorFromSubject("Quick question")).toBe("UNKNOWN");
    expect(doorFromSubject("payapp")).toBe("UNKNOWN");
    expect(doorFromSubject(null)).toBe("UNKNOWN");
    expect(doorFromSubject("")).toBe("UNKNOWN");
  });
  it("reads the subject out of every payload spelling", () => {
    expect(eventSubject({ subject: "x pay app" })).toBe("x pay app");
    expect(eventSubject({ email_subject: "x next bid" })).toBe("x next bid");
    expect(eventSubject({ sent_message: { subject: "x certified payroll" } })).toBe("x certified payroll");
    expect(eventSubject({})).toBeNull();
    expect(eventSubject("not an object")).toBeNull();
  });
});

describe("days", () => {
  it("buckets an instant on the viewer's calendar, not the server's", () => {
    const lateUtc = new Date("2026-10-15T03:30:00.000Z");
    expect(dayOf(lateUtc, "UTC")).toBe("2026-10-15");
    expect(dayOf(lateUtc, "America/Los_Angeles")).toBe("2026-10-14");
  });
  it("lists the window newest first, inclusive of today", () => {
    expect(windowDays("2026-10-15", 3)).toEqual(["2026-10-15", "2026-10-14", "2026-10-13"]);
    expect(windowDays("2026-03-01", 2)).toEqual(["2026-03-01", "2026-02-28"]);
  });
});

const ev = (id: string, type: string, at: string, payload: unknown = {}, leadId = "L1"): EventRecord => ({
  id,
  type,
  leadId,
  payload,
  occurredAt: new Date(at),
  createdAt: new Date("2000-01-01T00:00:00.000Z"),
});
const reply = (eventId: string, classification: string, door: ReplyRecord["door"], at: string, leadId = "L1"): ReplyRecord => ({
  eventId,
  leadId,
  companyName: "Baker",
  classification,
  door,
  status: "PENDING_REVIEW",
  receivedAt: new Date(at),
});

describe("tally", () => {
  const events = [
    ev("s1", "EMAIL_SENT", "2026-10-15T15:00:00Z", { subject: "Baker pay app" }),
    ev("s2", "EMAIL_SENT", "2026-10-15T15:00:00Z", { subject: "Baker next bid" }),
    ev("s3", "EMAIL_SENT", "2026-10-14T15:00:00Z", { subject: "no door here" }),
    ev("b1", "EMAIL_BOUNCE", "2026-10-15T15:00:00Z", { subject: "Baker pay app" }),
    ev("r1", "EMAIL_REPLY", "2026-10-15T16:00:00Z", { subject: "Re: Baker next bid" }),
    ev("r2", "EMAIL_REPLY", "2026-10-15T16:00:00Z", {}),
    ev("r3", "EMAIL_REPLY", "2026-10-15T16:00:00Z", { subject: "Re: Baker pay app" }, "L2"),
    ev("u1", "LEAD_UNSUBSCRIBED", "2026-10-15T16:00:00Z", {}),
    ev("x1", "LEAD_CATEGORY_UPDATED", "2026-10-15T16:00:00Z", {}),
    // Vendor sent no time: falls back to createdAt, far outside the window.
    { ...ev("s4", "EMAIL_SENT", "2026-10-15T15:00:00Z"), occurredAt: null },
  ];
  const replies = [
    // The agent's door (person-corrected) wins over the subject's TAKEOFF.
    reply("r1", "INTERESTED", "PAY_APP", "2026-10-15T16:00:00Z"),
    reply("r2", "STOP", "UNKNOWN", "2026-10-15T15:30:00Z"),
    // r3: positive on L2, no reply row for it on purpose — still a reply.
  ];
  const activities: ActivityRecord[] = [
    { type: "MEETING", leadId: "L1", occurredOn: new Date("2026-10-15T00:00:00Z"), summary: "demo" },
    { type: "DEMO", leadId: "L9", occurredOn: new Date("2026-10-14T00:00:00Z"), summary: "demo" },
    { type: "CALL", leadId: "L1", occurredOn: new Date("2026-10-15T00:00:00Z"), summary: "[CONVERSATION] x" },
    { type: "CALL", leadId: "L1", occurredOn: new Date("2026-10-15T00:00:00Z"), summary: "[WANTS_REPORT] send it" },
    // Files go to the door their tag names, not the lead's reply door (PAY_APP).
    { type: "NOTE", leadId: "L1", occurredOn: new Date("2026-10-15T00:00:00Z"), summary: filesReceivedSummary("CERTIFIED_PAYROLL") },
    { type: "NOTE", leadId: "L1", occurredOn: new Date("2026-10-14T00:00:00Z"), summary: "plain note, not files" },
  ];
  const cells = tally({ events, replies, activities }, "UTC");

  it("counts per door for the window, replies without an agent reading included", () => {
    const d = byDoor(cells, new Set(["2026-10-15", "2026-10-14"]));
    expect(d.PAY_APP).toEqual({ sent: 1, bounced: 1, replies: 2, positive: 1, suppressed: 0, meetings: 1, files: 0 });
    expect(d.TAKEOFF).toEqual({ sent: 1, bounced: 0, replies: 0, positive: 0, suppressed: 0, meetings: 0, files: 0 });
    expect(d.CERTIFIED_PAYROLL).toEqual({ sent: 0, bounced: 0, replies: 0, positive: 0, suppressed: 0, meetings: 0, files: 1 });
    expect(d.UNKNOWN).toEqual({ sent: 1, bounced: 0, replies: 1, positive: 0, suppressed: 2, meetings: 1, files: 0 });
  });

  it("drops an event outside the window and an event type it does not count", () => {
    const d = byDoor(cells, new Set(["2026-10-15"]));
    expect(d.UNKNOWN.sent).toBe(0);
    expect(cells.find((c) => c.day === "2000-01-01")?.counts.sent).toBe(1);
    expect(cells.length).toBe(12); // 9 counted events + 2 meetings + 1 files; x1 and the plain note are not cells
  });

  it("gives one row per day, newest first, zeros for a quiet day", () => {
    const rows = byDay(cells, windowDays("2026-10-15", 3));
    expect(rows.map((r) => r.day)).toEqual(["2026-10-15", "2026-10-14", "2026-10-13"]);
    expect(rows[0].counts).toEqual({ sent: 2, bounced: 1, replies: 3, positive: 1, suppressed: 2, meetings: 1, files: 1 });
    expect(rows[1].counts).toEqual({ sent: 1, bounced: 0, replies: 0, positive: 0, suppressed: 0, meetings: 1, files: 0 });
    expect(rows[2].counts).toEqual({ sent: 0, bounced: 0, replies: 0, positive: 0, suppressed: 0, meetings: 0, files: 0 });
  });

  it("builds today's board off the viewer's day and the Slack block from it", () => {
    const board = todayBoard({ cells, calls: activities, repliesWaiting: 4 }, "2026-10-15");
    expect(board.calls.dials).toBe(2);
    expect(board.calls.conversations).toBe(2);
    expect(board.calls.wantsReport).toBe(1);
    expect(board.email.sent).toBe(2);
    expect(board.email.files).toBe(1);
    const text = slackSummary(board, "2026-10-15");
    expect(text.split("\n")).toHaveLength(5);
    expect(text).toContain("Calls: 2 dials, 2 connects, 2 conversations, 1 yeses, 0 meetings booked");
    expect(text).toContain("Email: 2 sent, 1 bounced, 3 replies, 1 positive, 1 files received");
    expect(text).toContain("Replies waiting: 4");
    expect(todayBoard({ cells, calls: activities, repliesWaiting: 0 }, "2026-10-13").calls.dials).toBe(0);
  });
});

describe("filesReceivedDoor", () => {
  it("round-trips every door, reads an unknown door as UNKNOWN, and ignores other notes", () => {
    expect(filesReceivedDoor(filesReceivedSummary("PAY_APP"))).toBe("PAY_APP");
    expect(filesReceivedDoor(filesReceivedSummary("TAKEOFF"))).toBe("TAKEOFF");
    expect(filesReceivedDoor("[FILES RECEIVED · LETTER]")).toBe("UNKNOWN");
    expect(filesReceivedDoor("[REPLY SENT · assistant] thanks")).toBeNull();
    expect(filesReceivedDoor("files received by fax")).toBeNull();
  });
});

describe("rates and the kill line", () => {
  it("per 100 is null with nothing sent, never 0 or NaN", () => {
    expect(per100(0, 0)).toBeNull();
    expect(per100(3, 0)).toBeNull();
    expect(per100(1, 200)).toBe(0.5);
    expect(per100(2, 3)).toBe(66.7);
  });
  it("is undecided under 200 sent, dead under 1 per 100 after, alive at or above", () => {
    expect(coldIsDead(199, 0)).toBeNull();
    expect(coldIsDead(200, 1)).toBe(true);
    expect(coldIsDead(200, 2)).toBe(false);
    expect(coldIsDead(300, 3)).toBe(false);
    expect(coldIsDead(300, 2)).toBe(true);
  });
});
