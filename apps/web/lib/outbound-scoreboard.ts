/**
 * THE OUTBOUND SCOREBOARD IS A READ, NOT A TABLE.
 *
 * What went out and what came back, per day and per door, derived at request
 * time from rows the outbound machine already writes: `OutboundEvent` (the
 * vendor's raw events), `OutboundReply` (the agent's reading of a reply) and
 * `SalesActivity` (calls by disposition tag, meetings). Nothing here is
 * stored — a stored "replies today" would disagree with the rows the moment
 * somebody re-classified one — and nothing here takes a Prisma client. The
 * page reads; this counts.
 *
 * DOOR ATTRIBUTION. Smartlead does not label a send with the offer it
 * carried, so the door is read off the SUBJECT the sequence uses — one per
 * campaign, "{{company_name}} pay app" / "{{project}} certified payroll" /
 * "{{company_name}} next bid". A reply the agent has read carries
 * `OutboundReply.door`, which wins over the subject because a person can
 * correct it on /sales/replies. Anything else is UNKNOWN, and UNKNOWN is a
 * row on the board rather than a number silently folded into a door.
 *
 * DAYS. An event is an instant and is bucketed on the VIEWER's calendar
 * (`todayInZone`), the same rule as every "today" in this app. An activity's
 * `occurredOn` is already a calendar date at UTC midnight, so its day is its
 * ISO date and no zone applies.
 */

import { callScoreboard, type CallScoreboard } from "@/lib/call-dispositions";
import { todayInZone } from "@/lib/viewer-timezone";

export const DOORS = ["PAY_APP", "CERTIFIED_PAYROLL", "TAKEOFF", "UNKNOWN"] as const;
export type Door = (typeof DOORS)[number];

export const DOOR_LABEL: Record<Door, string> = {
  PAY_APP: "Pay app",
  CERTIFIED_PAYROLL: "Certified payroll",
  TAKEOFF: "Takeoff (next bid)",
  UNKNOWN: "Unknown",
};

/** The door a sequence subject pitches, or UNKNOWN. Tolerates reply prefixes. */
export function doorFromSubject(subject: string | null | undefined): Door {
  if (!subject) return "UNKNOWN";
  const s = subject.toLowerCase().replace(/\s+/g, " ");
  if (/\bpay app\b/.test(s)) return "PAY_APP";
  if (/\bcertified payroll\b/.test(s)) return "CERTIFIED_PAYROLL";
  if (/\bnext bid\b/.test(s)) return "TAKEOFF";
  return "UNKNOWN";
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** The subject a Smartlead payload carries, in every spelling seen (mirrors `replyFields`). */
export function eventSubject(payload: unknown): string | null {
  const p = obj(payload);
  return (
    str(p.subject) ??
    str(p.email_subject) ??
    str(p.subject_line) ??
    str(obj(p.reply).subject) ??
    str(obj(p.sent_message).subject) ??
    str(obj(p.sent_message_data).subject) ??
    null
  );
}

export type EventRecord = {
  id: string;
  type: string;
  leadId: string | null;
  payload: unknown;
  occurredAt: Date | null;
  createdAt: Date;
};

export type ReplyRecord = {
  eventId: string;
  leadId: string;
  companyName: string;
  classification: string;
  door: Door;
  status: string;
  receivedAt: Date;
};

export type ActivityRecord = { type: string; leadId: string; occurredOn: Date; summary: string };

export type Counts = {
  sent: number;
  bounced: number;
  replies: number;
  positive: number;
  suppressed: number;
  meetings: number;
};

export const POSITIVE_CLASSES = new Set(["INTERESTED", "SEND_INFO"]);
const isReplyType = (t: string) => /^(EMAIL_REPLY|EMAIL_REPLIED|UNTRACKED_REPLIES)$/.test(t);
const isUnsubType = (t: string) => /^(LEAD_UNSUBSCRIBED|EMAIL_UNSUBSCRIBED)$/.test(t);

const zero = (): Counts => ({ sent: 0, bounced: 0, replies: 0, positive: 0, suppressed: 0, meetings: 0 });

/** The viewer's calendar day for an instant. */
export function dayOf(instant: Date, zone: string): string {
  return todayInZone(zone, instant);
}

/** The calendar day a UTC-midnight date column denotes. */
export function dayOfDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The ISO days from `today - (days-1)` to `today`, newest first. */
export function windowDays(today: string, days: number): string[] {
  const out: string[] = [];
  const base = new Date(`${today}T00:00:00.000Z`).getTime();
  for (let i = 0; i < days; i++) out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

type Cell = { day: string; door: Door; counts: Counts };

/**
 * Every countable thing as (day, door, counts). Replies are counted off the
 * EVENT so a reply the agent has not read yet (no `OutboundReply` row) still
 * counts as a reply; the reply row, when present, supplies door and class.
 * A meeting is attributed to the door of the lead's latest reply, since a
 * meeting is not itself about a door.
 */
export function tally(
  input: { events: EventRecord[]; replies: ReplyRecord[]; activities: ActivityRecord[] },
  zone: string,
): Cell[] {
  const replyByEvent = new Map(input.replies.map((r) => [r.eventId, r]));
  const leadDoor = new Map<string, Door>();
  for (const r of [...input.replies].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    leadDoor.set(r.leadId, r.door);
  }
  const cells: Cell[] = [];
  for (const e of input.events) {
    const day = dayOf(e.occurredAt ?? e.createdAt, zone);
    const reply = replyByEvent.get(e.id);
    const door = reply?.door ?? doorFromSubject(eventSubject(e.payload));
    const c = zero();
    if (e.type === "EMAIL_SENT") c.sent = 1;
    else if (/^EMAIL_BOUNCE/.test(e.type)) c.bounced = 1;
    else if (isReplyType(e.type)) {
      c.replies = 1;
      if (reply && POSITIVE_CLASSES.has(reply.classification)) c.positive = 1;
      if (reply?.classification === "STOP") c.suppressed = 1;
    } else if (isUnsubType(e.type)) c.suppressed = 1;
    else continue;
    cells.push({ day, door, counts: c });
  }
  for (const a of input.activities) {
    if (a.type !== "MEETING" && a.type !== "DEMO") continue;
    const c = zero();
    c.meetings = 1;
    cells.push({ day: dayOfDate(a.occurredOn), door: leadDoor.get(a.leadId) ?? "UNKNOWN", counts: c });
  }
  return cells;
}

function add(into: Counts, c: Counts): Counts {
  for (const k of Object.keys(into) as (keyof Counts)[]) into[k] += c[k];
  return into;
}

export function byDoor(cells: Cell[], days: Set<string>): Record<Door, Counts> {
  const out = Object.fromEntries(DOORS.map((d) => [d, zero()])) as Record<Door, Counts>;
  for (const cell of cells) if (days.has(cell.day)) add(out[cell.door], cell.counts);
  return out;
}

export function byDay(cells: Cell[], days: string[]): { day: string; counts: Counts }[] {
  const out = new Map(days.map((d) => [d, zero()]));
  for (const cell of cells) {
    const row = out.get(cell.day);
    if (row) add(row, cell.counts);
  }
  return days.map((day) => ({ day, counts: out.get(day)! }));
}

/** Positive replies per 100 sent; null when nothing was sent (not 0 — 0 is a claim). */
export function per100(numerator: number, sent: number): number | null {
  return sent === 0 ? null : Math.round((numerator / sent) * 1000) / 10;
}

/**
 * The test's own kill line: "under 1 file per 100 after 200 firms = dead for
 * cold". Files are not a signal the app records, so the page feeds it the
 * nearest one it has and says which. Undecided (null) until 200 are out.
 */
export const KILL_LINE = { afterSent: 200, per100: 1 } as const;
export function coldIsDead(sent: number, files: number): boolean | null {
  if (sent < KILL_LINE.afterSent) return null;
  return (per100(files, sent) ?? 0) < KILL_LINE.per100;
}

export type TodayBoard = {
  calls: CallScoreboard;
  email: Counts;
  repliesWaiting: number;
};

export function todayBoard(
  input: { cells: Cell[]; calls: ActivityRecord[]; repliesWaiting: number },
  today: string,
): TodayBoard {
  const calls = callScoreboard(
    input.calls.filter((a) => a.type === "CALL" && dayOfDate(a.occurredOn) === today).map((a) => a.summary),
  );
  const email = byDay(input.cells, [today])[0].counts;
  return { calls, email, repliesWaiting: input.repliesWaiting };
}

/** Five lines for #prova-build. */
export function slackSummary(board: TodayBoard, today: string): string {
  const { calls, email } = board;
  return [
    `Outbound ${today}`,
    `Calls: ${calls.dials} dials, ${calls.connects} connects, ${calls.conversations} conversations, ${calls.meetings} meetings booked`,
    `Email: ${email.sent} sent, ${email.bounced} bounced, ${email.replies} replies, ${email.positive} positive`,
    `Suppressed: ${email.suppressed} · Meetings logged: ${email.meetings}`,
    `Replies waiting: ${board.repliesWaiting}`,
  ].join("\n");
}
