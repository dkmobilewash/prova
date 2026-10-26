import { dayAndTime, formatClock } from "@/lib/bid-dates";
import { money } from "@/lib/money";
import { surfaceHrefs } from "@/lib/bid/surfaceHrefs";
import {
  invitationWasSent,
  type GuideWallTypeFact,
  type JobGuideFacts,
  type PastPriceSuggestion,
} from "./facts";
import {
  GUIDE_STEP_KEYS,
  type GuideAction,
  type GuideAsk,
  type GuideStep,
  type GuideStepKey,
  type GuideTone,
  type JobGuide,
} from "./types";

/**
 * THE JOB GUIDE ENGINE — `JobGuideFacts` in, `JobGuide` out. PURE: no database,
 * no clock (the caller passes `now`), no model. Every sentence is assembled from
 * a field of the facts, so it cannot state a figure the facts do not hold and it
 * works with AI switched off (types.ts: the model narrates, code computes).
 *
 * ── THE ONE ASK ──
 *
 * The first rule that fires wins, earliest missing step first. When the bid has
 * not gone out:
 *
 *   1. no-drawings          no plan, nothing measured, no lines at all
 *   2. no-scale             floor-plan sheets with no scale, before any wall is measured
 *   3. no-walls-measured    drawings are in, nothing measured, no lines
 *   4. walls-not-added      walls are measured but none is in the estimate
 *   5. unpriced-wall-types  a used wall type has no price (past-price offer if one exists)
 *   6. unpriced-lines       other lines still have no price (cost-only indirects excepted)
 *   7. apply-recap          the job has a bid recap that was never applied
 *   8. proposal-ready       priced; read the proposal and send it
 *      send-due-soon        the same moment, but the deadline is inside DUE_SOON_HOURS
 *                           (or past), so the ask is the sending, not the reading
 *
 * Rules 3 and 6 are not in the first brief; they close two dead ends (a plan with
 * nothing measured, and a hand-built line with no price) that would otherwise
 * fall through to "proposal ready" on a bid that cannot be proposed. Rule 8's two
 * faces are one slot because the schema cannot say the proposal was opened (see
 * facts.ts): a ready bid is always "open the proposal" until the clock says it is
 * "send it now". Once any invitation is SUBMITTED (or WON/LOST) there is no ask.
 *
 * The rail follows the ask: steps before its step are done, its step is current,
 * the rest are todo. With no ask the bid is sent and all five are done.
 *
 * Rule 1 does not fire on a hand-built estimate (lines but no drawings), and
 * rule 2 does not fire once any wall is measured: both would nag forever over a
 * thing the bid no longer needs.
 *
 * DUE TIMES are the GC's wall clock, which the app deliberately never zones
 * (`bid-dates.ts`). They are read against `now` in UTC, so "soon" can be off by
 * the viewer's offset from UTC; the 48-hour window is wide enough that this
 * moves a boundary by an hour or two, never a day. A due day with no time
 * counts as the end of that day.
 */

/** "Due soon": inside this many hours of the deadline, or past it. */
export const DUE_SOON_HOURS = 48;

const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
const PRICE_BOOK_HREF = "/bid/price-book";

// ── small formatters ─────────────────────────────────────────────────────────

const count = (value: number): string => Math.round(value).toLocaleString("en-US");
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;
const feet = (value: number): string => `${count(value)} LF`;
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthDay(iso: string): string {
  return `${MONTH[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_DAY);
}

// ── the deadline ─────────────────────────────────────────────────────────────

export type GuideDue = { iso: string; minute: number | null };

export function guideWasSent(facts: Pick<JobGuideFacts, "invitations">): boolean {
  return facts.invitations.some((invitation) => invitationWasSent(invitation.status));
}

/**
 * The deadline that matters now: the earliest due date among invitations still
 * INVITED, else the bid project's, else the estimate's own. Null once the bid
 * has gone out, or when nobody recorded one.
 */
export function guideDue(facts: JobGuideFacts): GuideDue | null {
  if (guideWasSent(facts)) return null;
  const open = facts.invitations
    .filter((invitation) => invitation.status === "INVITED" && invitation.dueDate)
    .map((invitation) => ({ iso: invitation.dueDate as string, minute: invitation.dueMinute }))
    .sort((a, b) => dueMs(a) - dueMs(b));
  if (open[0]) return open[0];
  const fallback = facts.project?.bidDueDate ?? facts.jobBidDueDate;
  return fallback ? { iso: fallback, minute: null } : null;
}

/** The deadline as a number, for comparing and sorting. A day with no time is its last minute. */
export function dueMs(due: GuideDue): number {
  return Date.parse(`${due.iso}T00:00:00.000Z`) + (due.minute ?? 1439) * 60_000;
}

/** "due Thu 2:00 PM", "due tomorrow", "due Nov 3", "past due (Thu 2:00 PM)". */
function dueLabelFor(due: GuideDue, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const days = daysBetween(today, due.iso);
  const clock = due.minute === null ? "" : ` ${formatClock(due.minute)}`;
  if (dueMs(due) < now.getTime()) return `past due (${dayAndTime(due.iso, due.minute)})`;
  if (days === 0) return `due today${clock}`;
  if (days === 1) return `due tomorrow${clock}`;
  if (days <= 6) return `due ${dayAndTime(due.iso, due.minute)}`;
  return `due ${monthDay(due.iso)}${clock}`;
}

/** Ordering key for the home list: when the bid is due, or null. */
export function guideDueMs(facts: JobGuideFacts): number | null {
  const due = guideDue(facts);
  return due ? dueMs(due) : null;
}

// ── the ask ──────────────────────────────────────────────────────────────────

type Decision = {
  ask: GuideAsk | null;
  /** The words for the home list and the headline, per ask. */
  headline: string;
  oneLine: string;
  tone: GuideTone;
};

const wallTypeName = (type: GuideWallTypeFact): string =>
  type.name.trim() === "" || type.name === type.code ? type.code : `${type.code} ${type.name}`;

function unpricedWallTypes(facts: JobGuideFacts): GuideWallTypeFact[] {
  return facts.wallTypes.filter((type) => type.componentCount === 0 || type.unpricedLineCount > 0);
}

function pastPriceFor(facts: JobGuideFacts, type: GuideWallTypeFact): PastPriceSuggestion | null {
  return facts.pastPriceSuggestions?.find((suggestion) => suggestion.wallTypeCode === type.code) ?? null;
}

function decide(facts: JobGuideFacts, now: Date): Decision {
  const hrefs = surfaceHrefs("bid", facts.jobId);
  const open = (label: string, href: string, primary = false): GuideAction => ({ label, href, ...(primary ? { primary } : {}) });

  if (guideWasSent(facts)) {
    return { ask: null, headline: "This bid is in.", oneLine: "Sent, waiting on a decision", tone: "working" };
  }

  const due = guideDue(facts);
  const dueLabel = due ? dueLabelFor(due, now) : null;
  const msToDue = due ? dueMs(due) - now.getTime() : null;
  const pastDue = msToDue !== null && msToDue < 0;
  const dueSoon = msToDue !== null && msToDue <= DUE_SOON_HOURS * MS_HOUR;
  /** A bid past its deadline reads as blocked whatever the ask is. */
  const toneFor = (tone: GuideTone): GuideTone => (pastDue ? "blocked" : tone);
  const lateLine = (line: string): string => (pastDue ? `Past due. ${line}` : line);

  // 1. No drawings at all.
  if (!facts.hasTakeoffPlan && facts.wallRunCount === 0 && facts.lineCount === 0) {
    return {
      ask: {
        id: "no-drawings",
        step: facts.invitations.length > 0 || facts.project ? "walls" : "invite",
        title: `No drawings are uploaded for ${facts.name} yet.`,
        body: "Upload the plan set and C Stream can read the sheets and start measuring the walls.",
        actions: [open("Upload the drawings", hrefs.takeoff, true)],
      },
      headline: "Let's start with the drawings.",
      oneLine: lateLine("No drawings yet"),
      tone: "blocked",
    };
  }

  // 2. Floor-plan sheets with no scale, while nothing has been measured.
  if (facts.sheetsMissingScale > 0 && facts.wallRunCount === 0 && facts.lineCount === 0) {
    const n = facts.sheetsMissingScale;
    return {
      ask: {
        id: "no-scale",
        step: "walls",
        title: `${plural(n, "plan sheet has", "plan sheets have")} no scale set.`,
        body: "Set the scale on each one so the walls measure true.",
        actions: [open("Set the scale", hrefs.workspace, true), open("Open the takeoff", hrefs.takeoff)],
      },
      headline: "Drawings are in. One thing needs you.",
      oneLine: lateLine(`${plural(n, "sheet needs", "sheets need")} a scale`),
      tone: toneFor("question"),
    };
  }

  // 3. Drawings but nothing measured and nothing in the estimate.
  if (facts.hasTakeoffPlan && facts.wallRunCount === 0 && facts.lineCount === 0) {
    const sheets = facts.sheetCount > 0 ? `${plural(facts.sheetCount, "sheet is", "sheets are")} in` : "The drawings are in";
    return {
      ask: {
        id: "no-walls-measured",
        step: "walls",
        title: `${sheets}, and no walls are measured yet.`,
        body: "Open the takeoff and measure the walls. Each wall type you use gets priced next.",
        actions: [open("Measure the walls", hrefs.workspace, true), open("Open the takeoff", hrefs.takeoff)],
      },
      headline: "Drawings are in. One thing needs you.",
      oneLine: lateLine("Walls not measured yet"),
      tone: toneFor("question"),
    };
  }

  // 4. Walls measured, none of them in the estimate.
  if (facts.wallRunCount > 0 && facts.wallLineCount === 0 && facts.wallTypes.some((type) => type.componentCount > 0)) {
    return {
      ask: {
        id: "walls-not-added",
        step: "walls",
        title: `${feet(facts.measuredFootageFt)} of walls are measured but not in the estimate yet.`,
        body: "Add them to the estimate so each wall type turns into lines you can price.",
        actions: [open("Add the walls to the estimate", hrefs.estimate, true)],
      },
      headline: "Walls are measured. One thing needs you.",
      oneLine: lateLine("Measured walls not in the estimate"),
      tone: toneFor("update"),
    };
  }

  // 5. Wall types with no price.
  const unpriced = unpricedWallTypes(facts);
  if (unpriced.length > 0) {
    const first = unpriced[0]!;
    const more = unpriced.length - 1;
    const past = pastPriceFor(facts, first);
    const actions: GuideAction[] = [];
    if (past) {
      actions.push({ label: "Use that price", actionId: "usePastPrice", actionArg: past.actionArg ?? first.code, primary: true });
      actions.push(open("Add a different price", PRICE_BOOK_HREF));
    } else {
      actions.push(open("Add a price", PRICE_BOOK_HREF, true));
    }
    const moreSentence = more > 0 ? ` ${plural(more, "other wall type is", "other wall types are")} unpriced too.` : "";
    const body = past
      ? `You priced ${past.label} on ${past.fromJobName} ${past.whenLabel}. Use that?${moreSentence}`
      : first.componentCount === 0
        ? `${wallTypeName(first)} has no materials or labor set up, so it cannot be priced yet.${moreSentence}`
        : `Add a price once and every bid after this one starts from it.${moreSentence}`;
    return {
      ask: {
        id: "unpriced-wall-types",
        step: "price",
        title: `${wallTypeName(first)} (${feet(first.lengthFt)}) has no price in your price book.`,
        body,
        actions,
      },
      headline: "Almost priced. One thing needs you.",
      oneLine: lateLine(more > 0 ? `${first.code} and ${plural(more, "more wall type", "more wall types")} have no price` : `${first.code} wall has no price`),
      tone: toneFor("question"),
    };
  }

  // 6. Other lines with no price.
  if (facts.linesWithoutPrice > 0) {
    const n = facts.linesWithoutPrice;
    return {
      ask: {
        id: "unpriced-lines",
        step: "price",
        title: `${plural(n, "estimate line has", "estimate lines have")} no price.`,
        body: "Price them on the estimate, or take them off if they are not part of this bid.",
        actions: [open("Price the lines", hrefs.estimate, true)],
      },
      headline: "Almost priced. One thing needs you.",
      oneLine: lateLine(`${plural(n, "line has", "lines have")} no price`),
      tone: toneFor("question"),
    };
  }

  // 7. A recap that was never applied.
  if (facts.recap && facts.recap.appliedAt === null) {
    const added = facts.recap.addedTotal;
    return {
      ask: {
        id: "apply-recap",
        step: "price",
        title: "Your markup recap is set up but not on the prices yet.",
        body:
          added > 0
            ? `Applying it adds ${money(added)} to the bid.`
            : "Applying it puts your markup on the line prices.",
        actions: [
          { label: "Apply the recap", actionId: "applyRecap", actionArg: facts.jobId, primary: true },
          open("Review the recap", hrefs.recap),
        ],
      },
      headline: "Priced. One thing needs you.",
      oneLine: lateLine("Markup recap not applied"),
      tone: toneFor("update"),
    };
  }

  // 8. Ready. If the clock says so, the ask is sending.
  const total = money(facts.bidTotal);
  if (dueSoon && dueLabel) {
    return {
      ask: {
        id: "send-due-soon",
        step: "send",
        title:
          pastDue && due
            ? `This bid was due ${dayAndTime(due.iso, due.minute)} and has not gone out.`
            : `This bid is ${dueLabel} and has not gone out yet.`,
        body: `The proposal is ready at ${total}. Open it, read it through and send it.`,
        actions: [open("Open the proposal", hrefs.proposal, true)],
      },
      headline: pastDue ? "Ready to send, and the deadline has passed." : "Ready to send, and the clock is running.",
      oneLine: pastDue ? "Past due and not sent" : `${capitalise(dueLabel)}, not sent`,
      tone: pastDue ? "blocked" : "ready",
    };
  }
  return {
    ask: {
      id: "proposal-ready",
      step: "proposal",
      title: `The proposal is ready to open at ${total}.`,
      body: dueLabel ? `Read it through, then send it to ${facts.gcName ?? "the GC"}. The bid is ${dueLabel}.` : `Read it through, then send it to ${facts.gcName ?? "the GC"}.`,
      actions: [open("Open the proposal", hrefs.proposal, true)],
    },
    headline: "Ready to go out.",
    oneLine: `Ready to send, ${total}`,
    tone: "ready",
  };
}

// ── the rail ─────────────────────────────────────────────────────────────────

const STEP_LABEL: Record<GuideStepKey, string> = {
  invite: "Invite read",
  walls: "Walls measured",
  price: "Price it",
  proposal: "Proposal",
  send: "Send",
};

function summaryFor(key: GuideStepKey, facts: JobGuideFacts, dueLabel: string | null, ask: GuideAsk | null): string | null {
  switch (key) {
    case "invite": {
      const parts = [facts.gcName, dueLabel].filter((part): part is string => !!part);
      return parts.length > 0 ? capitalise(parts.join(" · ")) : null;
    }
    case "walls": {
      if (facts.wallRunCount > 0) {
        const parts = [feet(facts.measuredFootageFt)];
        if (facts.openingsCount > 0) parts.push(plural(facts.openingsCount, "opening", "openings"));
        if (facts.sheetCount > 0) parts.push(plural(facts.sheetCount, "sheet", "sheets"));
        return parts.join(" · ");
      }
      if (facts.hasTakeoffPlan) return facts.sheetCount > 0 ? `${plural(facts.sheetCount, "sheet", "sheets")}, none measured yet` : "Drawings uploaded";
      return null;
    }
    case "price": {
      if (facts.lineCount === 0) return null;
      const parts = [facts.bidTotal > 0 ? money(facts.bidTotal) : null, plural(facts.lineCount, "line", "lines")].filter(
        (part): part is string => !!part,
      );
      if (facts.linesWithoutPrice > 0) parts.push(`${count(facts.linesWithoutPrice)} without a price`);
      return parts.join(" · ");
    }
    case "proposal":
      return ask && (ask.id === "proposal-ready" || ask.id === "send-due-soon") ? "Ready to open" : null;
    case "send":
      return guideWasSent(facts) ? "Sent" : dueLabel ? capitalise(dueLabel) : null;
  }
}

function firstUnfinished(facts: JobGuideFacts): number {
  const done: Record<GuideStepKey, boolean> = {
    invite: facts.invitations.length > 0 || !!facts.project || facts.hasTakeoffPlan || facts.lineCount > 0 || facts.wallRunCount > 0,
    walls: facts.lineCount > 0,
    price: facts.lineCount > 0 && facts.linesWithoutPrice === 0 && unpricedWallTypes(facts).length === 0,
    proposal: guideWasSent(facts),
    send: guideWasSent(facts),
  };
  const index = GUIDE_STEP_KEYS.findIndex((key) => !done[key]);
  return index === -1 ? GUIDE_STEP_KEYS.length : index;
}

// ── the guide ────────────────────────────────────────────────────────────────

export function buildJobGuide(facts: JobGuideFacts, now: Date): JobGuide {
  const decision = decide(facts, now);
  const due = guideDue(facts);
  const dueLabel = due ? dueLabelFor(due, now) : null;

  const current = decision.ask ? GUIDE_STEP_KEYS.indexOf(decision.ask.step) : guideWasSent(facts) ? GUIDE_STEP_KEYS.length : firstUnfinished(facts);

  const steps: GuideStep[] = GUIDE_STEP_KEYS.map((key, index) => ({
    key,
    label: STEP_LABEL[key],
    status: index < current ? "done" : index === current ? "current" : "todo",
    summary: summaryFor(key, facts, dueLabel, decision.ask),
  }));

  return {
    jobId: facts.jobId,
    name: facts.name,
    gcName: facts.gcName,
    dueLabel,
    steps,
    headline: decision.headline,
    ask: decision.ask,
    bidSoFar: facts.bidTotal > 0 ? facts.bidTotal : null,
    tone: decision.tone,
    oneLine: decision.oneLine,
  };
}
