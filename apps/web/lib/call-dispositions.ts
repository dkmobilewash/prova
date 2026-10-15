/**
 * ONE CALL, ONE BUTTON, ONE ROW — and nothing new in the schema.
 *
 * A dialing session is sixty to eighty calls a day, and the thing that
 * decides whether any of it can be improved is whether every one of them was
 * logged with WHAT HAPPENED. The activity form takes a free-text summary,
 * which is right for a conversation and wrong for the fifty calls a day that
 * are "no answer": nobody types fifty summaries, so nothing gets logged, so
 * the connect rate is a feeling.
 *
 * So a call is logged as a `SalesActivity` of type CALL whose summary BEGINS
 * WITH A TAG — `[VOICEMAIL]`, `[CONVERSATION]` — followed by whatever the
 * caller typed. The tag is the disposition; the rest is the note. Nothing is
 * stored that the schema does not already hold, which keeps this out of the
 * shared `sales.prisma` (Diego's lane, and a rule-4 announcement on its own),
 * and the scoreboard on /sales is DERIVED from the tags on the day's rows —
 * the same "never store what you can derive" rule as the fit band.
 *
 * The cost of that choice is that a summary somebody edits by hand can lose
 * its tag, and then the call counts as "untagged" rather than as any
 * disposition. That is the honest outcome: the row still says a call
 * happened, and the scoreboard says it could not tell what kind.
 *
 * `DO_NOT_CALL` is deliberately a disposition rather than a flag on the lead.
 * The flag is coming (`doNotContact`, in the announced schema) and when it
 * lands this tag is what it is backfilled from. Until then
 * `doNotCallFrom(activities)` reads it off the latest CALL, so a lead that
 * asked to be left alone shows it on the next visit without a column.
 */

export const CALL_DISPOSITIONS = [
  "NO_ANSWER",
  "VOICEMAIL",
  "GATEKEEPER",
  "CONVERSATION",
  "MEETING_BOOKED",
  "NOT_NOW",
  "WRONG_NUMBER",
  "DO_NOT_CALL",
] as const;

export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

export const CALL_DISPOSITION_LABEL: Record<CallDisposition, string> = {
  NO_ANSWER: "No answer",
  VOICEMAIL: "Left voicemail",
  GATEKEEPER: "Gatekeeper",
  CONVERSATION: "Conversation",
  MEETING_BOOKED: "Meeting booked",
  NOT_NOW: "Not now",
  WRONG_NUMBER: "Wrong number",
  DO_NOT_CALL: "Do not call",
};

/**
 * When the next attempt is owed, in days from the call, or null for "nothing
 * owed". The cadence the playbook settled on: a miss is retried in two days
 * at a different hour; "not now" comes back in a month; a conversation or a
 * meeting is followed up by hand with a date the caller chooses; a wrong
 * number or a do-not-call owes nothing ever again.
 */
export const CALL_FOLLOW_UP_DAYS: Record<CallDisposition, number | null> = {
  NO_ANSWER: 2,
  VOICEMAIL: 2,
  GATEKEEPER: 2,
  CONVERSATION: null,
  MEETING_BOOKED: null,
  NOT_NOW: 30,
  WRONG_NUMBER: null,
  DO_NOT_CALL: null,
};

const TAG = /^\[([A-Z_]+)\]\s*/;

/** The summary a logged call is stored with. */
export function callSummary(disposition: CallDisposition, note: string): string {
  const trimmed = note.trim();
  return trimmed ? `[${disposition}] ${trimmed}` : `[${disposition}]`;
}

/** The disposition a stored summary carries, or null if it carries none. */
export function dispositionOf(summary: string): CallDisposition | null {
  const match = TAG.exec(summary);
  if (!match) return null;
  const tag = match[1] as CallDisposition;
  return (CALL_DISPOSITIONS as readonly string[]).includes(tag) ? tag : null;
}

/** The note without its tag, for display. */
export function noteOf(summary: string): string {
  return summary.replace(TAG, "").trim();
}

export type CallScoreboard = {
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  untagged: number;
  byDisposition: Record<CallDisposition, number>;
};

/**
 * A day's calls as the playbook counts them. A DIAL is any CALL row. A
 * CONNECT is a human picking up — gatekeeper included, because the number
 * worked even if the person did not. A CONVERSATION is the person we wanted.
 * Reading connects as "conversation or better" would make a day of
 * gatekeepers look like a day of zero connects, which is the wrong lesson:
 * that day's list was fine and its hours were wrong.
 */
export function callScoreboard(summaries: readonly string[]): CallScoreboard {
  const byDisposition = Object.fromEntries(
    CALL_DISPOSITIONS.map((d) => [d, 0]),
  ) as Record<CallDisposition, number>;
  let untagged = 0;
  for (const summary of summaries) {
    const d = dispositionOf(summary);
    if (d === null) untagged++;
    else byDisposition[d]++;
  }
  const conversations =
    byDisposition.CONVERSATION +
    byDisposition.MEETING_BOOKED +
    byDisposition.NOT_NOW +
    byDisposition.DO_NOT_CALL;
  return {
    dials: summaries.length,
    connects: conversations + byDisposition.GATEKEEPER + byDisposition.WRONG_NUMBER,
    conversations,
    meetings: byDisposition.MEETING_BOOKED,
    untagged,
    byDisposition,
  };
}

/**
 * Whether the lead's LATEST call said to stop. Latest by the order the
 * caller passes, which on both sales pages is newest first; this reads the
 * first CALL it meets and ignores everything older, so a do-not-call that
 * was later overridden by a logged conversation does not stick.
 */
export function doNotCallFrom(
  activities: readonly { type: string; summary: string }[],
): boolean {
  const latestCall = activities.find((a) => a.type === "CALL");
  return latestCall ? dispositionOf(latestCall.summary) === "DO_NOT_CALL" : false;
}
