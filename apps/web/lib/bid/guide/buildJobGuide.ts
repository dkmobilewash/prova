import { dayAndTime, formatClock, upcomingBidDates, type UpcomingBidDate } from "@/lib/bid-dates";
import { money } from "@/lib/money";
import { surfaceHrefs } from "@/lib/bid/surfaceHrefs";
import { bidLogHrefs } from "@/lib/bid/bidLogHrefs";
import {
  invitationFactWasSent,
  type GuideAddendumFact,
  type GuideInvitationFact,
  type GuideWallTypeFact,
  type JobGuideFacts,
  type PastPriceSuggestion,
} from "./facts";
import { WALL_HEIGHT_CHOICES, wallHeightArg } from "./wallHeight";
import { BOARD_LAYER_CHOICES, boardLayersArg } from "./boardLayers";
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
 *   0. job-walk             the job walk is today, tomorrow or the day after
 *      rfi-cutoff           RFI questions close today, tomorrow or the day after
 *                           — both SKIPPED while the bid itself is due inside
 *                           DUE_SOON_HOURS (or past): see "dates that pass" below
 *   1. no-drawings          no plan, nothing measured, no lines at all
 *   2. no-scale             floor-plan sheets with no scale, before anything is measured
 *   3. no-walls-measured    drawings are in, nothing measured (no wall run, nothing
 *                           by hand), no lines
 *  3b. wall-height          a measured wall type has no height, so its runs add nothing
 *  3c. board-layers         a measured wall type's board layers are unanswered, and
 *                           it has a per-layer part, so the answer moves its board
 *   4. walls-not-added      walls are measured but none is in the estimate — or,
 *                           with no wall run to add, measurements made by hand
 *                           and an estimate with no lines at all
 *   5. unpriced-wall-types  a used wall type has no price (past-price offer if one exists)
 *   6. unpriced-lines       other lines still have no price (cost-only indirects excepted)
 *   7. apply-recap          the job has a bid recap that was never applied; says what
 *                           Apply does to the line total (lowers/raises/leaves it)
 *  7b. addendum-unacknowledged  an addendum is not acknowledged on a still-open GC's form
 *   8. proposal-ready       priced; read the proposal and send it
 *      send-due-soon        the same moment, but the deadline is inside DUE_SOON_HOURS
 *                           (or past), so the ask is the sending, not the reading
 *
 * DATES THAT PASS (rule 0). Every other ask waits for the person: drawings can
 * be uploaded and walls priced tomorrow as well as today. A job walk and an RFI
 * cutoff do not wait — once the day goes by the chance is gone and nothing in
 * the app can bring it back — so inside DATE_HEADS_UP_DAYS they come FIRST. The
 * one thing they do not beat is the bid's own deadline: inside DUE_SOON_HOURS
 * the bid going out is the more expensive thing to miss, and a blocked bid due
 * tomorrow must still say what blocks it rather than talk about a walk. A walk
 * today is shown all day, whatever its minute: the minute is the GC's wall
 * clock and is never zoned (same as `dueMinute`), so hiding a walk "already
 * past" could hide one that has not started where the job is.
 *
 * PAPER (rule 7b). An unacknowledged addendum gets a bid thrown out unread
 * (bid-compliance.prisma), but acknowledging it is something done ON the form
 * that goes out. So it is asked the moment the bid is otherwise priced — after
 * the work, before "open the proposal" and before "send it now", so nobody is
 * told to send a form that is missing it.
 *
 * Rules 3 and 6 are not in the first brief; they close two dead ends (a plan with
 * nothing measured, and a hand-built line with no price) that would otherwise
 * fall through to "proposal ready" on a bid that cannot be proposed. Rule 8's two
 * faces are one slot because the schema cannot say the proposal was opened (see
 * facts.ts): a ready bid is always "open the proposal" until the clock says it is
 * "send it now". Once any invitation is SUBMITTED (or WON/LOST), or the app has
 * a record of emailing one (`proposalSentOn`, facts.ts), there is no ask.
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

/** A walk or an RFI cutoff this many calendar days out (0 = today) is asked about. */
export const DATE_HEADS_UP_DAYS = 2;

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

const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A day said the way a person says it, relative to today: "today", "tomorrow",
 * "yesterday", "Thursday" inside a week either way, else "Oct 14". UTC, like
 * every stored day. */
function spokenDay(iso: string, now: Date): string {
  const days = daysBetween(now.toISOString().slice(0, 10), iso);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (Math.abs(days) <= 6) return WEEKDAY_NAME[new Date(`${iso}T00:00:00.000Z`).getUTCDay()]!;
  return monthDay(iso);
}

/** "Addendum 2" for a bare "2" or "3R"; the GC's own words otherwise ("ASI 3"). */
function addendumName(reference: string): string {
  const text = reference.trim();
  return /^\d+[A-Za-z]?$/.test(text) ? `Addendum ${text}` : text;
}

const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

// ── the deadline ─────────────────────────────────────────────────────────────

export type GuideDue = { iso: string; minute: number | null };

export function guideWasSent(facts: Pick<JobGuideFacts, "invitations">): boolean {
  return facts.invitations.some(invitationFactWasSent);
}

/** The first day the app emailed any of this job's GCs the bid, `YYYY-MM-DD`,
 *  or null when it never has (a status set by hand carries no date). */
export function guideSentOn(facts: Pick<JobGuideFacts, "invitations">): string | null {
  const days = facts.invitations.map((invitation) => invitation.proposalSentOn).filter((value): value is string => !!value);
  return days.length > 0 ? days.sort()[0]! : null;
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

/** Measured wall types whose heightless runs price nothing, by code. */
function heightlessWallTypes(facts: JobGuideFacts): (GuideWallTypeFact & { heightless: NonNullable<GuideWallTypeFact["heightless"]> })[] {
  return facts.wallTypes.filter(
    (type): type is GuideWallTypeFact & { heightless: NonNullable<GuideWallTypeFact["heightless"]> } =>
      !!type.heightless && type.heightless.runCount > 0 && type.componentCount > 0,
  );
}

type Layerless = GuideWallTypeFact & { layersUnanswered: NonNullable<GuideWallTypeFact["layersUnanswered"]> };

/** Measured wall types whose board-layer answer would change their board, by code. */
function layerlessWallTypes(facts: JobGuideFacts): Layerless[] {
  return facts.wallTypes.filter(
    (type): type is Layerless => !!type.layersUnanswered && type.layersUnanswered.runCount + (type.layersUnanswered.itemCount ?? 0) > 0 && type.componentCount > 0,
  );
}

/**
 * "Applying it lowers the bid by $2,924.50, from $34,915.00 to $31,990.50." —
 * the change Apply makes to the line total, compared in cents. With no figure
 * (`landsAt` null: Apply would write nothing) it promises none.
 */
function applyRecapSentence(linesNow: number, landsAt: number | null): string {
  if (landsAt === null) return "Applying it puts your markup on the line prices.";
  const change = Math.round(landsAt * 100) - Math.round(linesNow * 100);
  if (change === 0) return `Applying it leaves the bid at ${money(landsAt)}.`;
  const by = money(Math.abs(change) / 100);
  return `Applying it ${change < 0 ? "lowers" : "raises"} the bid by ${by}, from ${money(linesNow)} to ${money(landsAt)}.`;
}

type DatedItem = UpcomingBidDate & { invitation: GuideInvitationFact };

/**
 * The walks and RFI cutoffs of still-open invitations inside
 * DATE_HEADS_UP_DAYS, soonest first; a walk before an RFI cutoff on the same
 * day (it has a place and a time to be at). `upcomingBidDates` is the bid log's
 * own rule for "coming up", so the two cannot disagree about what is near.
 */
function upcomingDates(facts: JobGuideFacts, now: Date): DatedItem[] {
  const today = now.toISOString().slice(0, 10);
  const asDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
  const out: DatedItem[] = [];
  for (const invitation of facts.invitations) {
    if (invitation.status !== "INVITED") continue;
    const dates = upcomingBidDates(
      { walkDate: asDate(invitation.walkDate), walkMinute: invitation.walkMinute ?? null, rfiCutoffDate: asDate(invitation.rfiCutoffDate) },
      today,
      DATE_HEADS_UP_DAYS,
    );
    for (const date of dates) out.push({ ...date, invitation });
  }
  const kindOrder = (kind: DatedItem["kind"]) => (kind === "walk" ? 0 : 1);
  return out.sort(
    (a, b) => a.daysLeft - b.daysLeft || kindOrder(a.kind) - kindOrder(b.kind) || (a.minute ?? 1440) - (b.minute ?? 1440),
  );
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

  // 0. A job walk or an RFI cutoff about to pass — unless the bid itself is due
  // first (see "dates that pass" in the header).
  const dated = dueSoon ? undefined : upcomingDates(facts, now)[0];
  if (dated) {
    const when = spokenDay(dated.iso, now);
    const bidLog = `${bidLogHrefs("bid").list}#${dated.invitation.id}`;
    const gc = dated.invitation.gcName ?? null;
    const step = GUIDE_STEP_KEYS[Math.min(firstUnfinished(facts), GUIDE_STEP_KEYS.length - 1)]!;
    if (dated.kind === "walk") {
      const at = dated.minute === null ? "" : ` at ${formatClock(dated.minute)}`;
      return {
        ask: {
          id: "job-walk",
          step,
          title: `The job walk is ${when}${at}.`,
          body: "Bring the plan set and a list of what the drawings leave open.",
          actions: [open("See the bid", bidLog, true)],
        },
        headline: "The job walk is coming up.",
        oneLine: dated.label,
        tone: "update",
      };
    }
    return {
      ask: {
        id: "rfi-cutoff",
        step,
        title: `RFI questions are due ${when}.`,
        body: `Send ${gc ?? "the GC"} anything the drawings leave open before then. After that, you price what you assume.`,
        actions: [open("See the bid", bidLog, true)],
      },
      headline: "Questions to the GC close soon.",
      oneLine: dated.label,
      tone: "update",
    };
  }

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

  // Measured by hand counts as measured (facts.ts, "by hand"): rules 2 and 3
  // must not tell somebody who has traced 237 LF that nothing is measured.
  const hand = facts.handMeasurements;
  const nothingMeasured = facts.wallRunCount === 0 && hand.count === 0;

  // 2. Floor-plan sheets with no scale, while nothing has been measured.
  if (facts.sheetsMissingScale > 0 && nothingMeasured && facts.lineCount === 0) {
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
  if (facts.hasTakeoffPlan && nothingMeasured && facts.lineCount === 0) {
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

  // 3b. A measured wall type with no height. WHY HERE: a run with no height of
  // its own on a type with no default produces NOTHING (`runGeometry` returns
  // null), so its walls never become lines. Asked after "measure the walls"
  // (there is nothing to ask until a run exists) and BEFORE "add the walls to
  // the estimate" and every price ask, because both of those read LINES: rule 4
  // would add walls that turn into nothing, and rule 5 cannot see a type that
  // has no lines to be unpriced — the walls would be missing from the bid with
  // no ask saying so, and the guide would fall through to "proposal ready".
  const heightless = heightlessWallTypes(facts);
  if (heightless.length > 0) {
    const first = heightless[0]!;
    const { runCount, lengthFt } = first.heightless;
    const more = heightless.length - 1;
    const moreSentence = more > 0 ? ` ${plural(more, "other wall type needs", "other wall types need")} a height too.` : "";
    return {
      ask: {
        id: "wall-height",
        step: "walls",
        title: `How tall are the ${first.code} walls on ${facts.name}?`,
        body:
          `${count(runCount)} ${runCount === 1 ? "run" : "runs"} of ${first.code} (${feet(lengthFt)}) ${runCount === 1 ? "has" : "have"} no height, ` +
          `so ${runCount === 1 ? "it adds" : "they add"} nothing to the estimate yet. Your answer becomes ${possessive(first.code)} default height in your wall types.${moreSentence}`,
        actions: [
          ...WALL_HEIGHT_CHOICES.map(
            (heightFt): GuideAction => ({
              label: `${heightFt} ft`,
              actionId: "setWallHeight",
              actionArg: wallHeightArg({ wallTypeId: first.wallTypeId, token: first.heightless.token }, heightFt),
              chip: true,
              confirm: `Make ${first.code} ${heightFt} ft tall in your wall types, and work this estimate's walls out again from them?`,
            }),
          ),
          open("Another height", hrefs.wallTypes),
        ],
      },
      headline: "Walls are measured. One thing needs you.",
      oneLine: lateLine(more > 0 ? `${first.code} and ${plural(more, "more wall type", "more wall types")} need a height` : `${first.code} walls need a height`),
      tone: toneFor("question"),
    };
  }

  // 3c. A measured wall type whose board layers nobody has said. WHY HERE:
  // after the height (a run with no height produces nothing at all, so its
  // board cannot be wrong yet), and BEFORE adding the walls and every price
  // ask, because the answer moves the board quantity — pricing first would
  // price a number that is about to change. Only a type with a per-layer part
  // is asked (`./boardLayers.ts`): for any other, no answer changes anything.
  const layerless = layerlessWallTypes(facts);
  if (layerless.length > 0) {
    const first = layerless[0]!;
    const { runCount, lengthFt, sides } = first.layersUnanswered;
    const itemCount = first.layersUnanswered.itemCount ?? 0;
    // "3 runs", "1 takeoff item", "3 runs and 1 takeoff item" — both carry the
    // type's board (`./boardLayers.ts`), so the sentence names both.
    const walls = [
      runCount > 0 ? plural(runCount, "run", "runs") : null,
      itemCount > 0 ? plural(itemCount, "takeoff item", "takeoff items") : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" and ");
    const one = runCount + itemCount === 1;
    const side = sides === 1 ? "on its one boarded side" : "each side";
    const more = layerless.length - 1;
    const moreSentence = more > 0 ? ` ${plural(more, "other wall type needs", "other wall types need")} a layer count too.` : "";
    const layersOf = (n: number) => `${n} ${n === 1 ? "layer" : "layers"}`;
    return {
      ask: {
        id: "board-layers",
        step: "walls",
        title: `How many layers of board are on the ${first.code} walls on ${facts.name}?`,
        body:
          `${walls} of ${first.code} (${feet(lengthFt)}) ${one ? "is" : "are"} counted at one layer ${side} until you say. ` +
          `Two layers doubles the board. Your answer becomes ${possessive(first.code)} board layers in your wall types.${moreSentence}`,
        actions: [
          ...BOARD_LAYER_CHOICES.map(
            (layers): GuideAction => ({
              // "1 layer each side" on a two-sided wall; "1 layer" on furring,
              // whose one side the title has already named.
              label: sides === 1 ? layersOf(layers) : `${layersOf(layers)} each side`,
              actionId: "setBoardLayers",
              actionArg: boardLayersArg({ wallTypeId: first.wallTypeId, token: first.layersUnanswered.token }, layers),
              chip: true,
              confirm: `Make ${first.code} ${layersOf(layers)} of board ${side} in your wall types, and work this estimate's walls out again from them?`,
            }),
          ),
          open("Three or more", hrefs.wallTypes),
        ],
      },
      headline: "Walls are measured. One thing needs you.",
      oneLine: lateLine(
        more > 0
          ? `${first.code} and ${plural(more, "more wall type", "more wall types")} need a board layer count`
          : `${first.code} walls need a board layer count`,
      ),
      tone: toneFor("question"),
    };
  }

  // 4. Walls measured, none of them in the estimate.
  if (facts.wallRunCount > 0 && facts.wallLineCount === 0 && facts.wallTypes.some((type) => type.runCount > 0 && type.componentCount > 0)) {
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

  // 4, by hand. Measurements with no wall type ("Add as plain measurements —
  // priced by hand") and an estimate with no lines: the takeoff is done and
  // none of it is on the estimate. Same id and step as the wall-run case — it
  // is the same moment of the bid — in words that do not promise wall types.
  // ONLY while the estimate is empty: a sub who typed the lines in instead of
  // posting the measurements has priced the job, and asking forever about
  // measurements the bid no longer needs is the dead end rules 1 and 2 avoid.
  if (hand.count > 0 && facts.lineCount === 0) {
    const what =
      hand.lengthFt > 0
        ? `${feet(hand.lengthFt)} is measured by hand`
        : `${plural(hand.count, "measurement is", "measurements are")} on the takeoff`;
    return {
      ask: {
        id: "walls-not-added",
        step: "walls",
        title: `${what} but not on the estimate yet.`,
        body: "Pick them in the takeoff's list of measurements and add them to the estimate as lines to price, or type the lines in on the estimate.",
        actions: [open("Add them to the estimate", hrefs.takeoff, true), open("Type the lines in", hrefs.estimate)],
      },
      headline: "Measured. One thing needs you.",
      oneLine: lateLine("Measurements not on the estimate"),
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
  //
  // THE SENTENCE STATES WHAT PRESSING APPLY DOES TO THE BID ON THE LINES: from
  // `bidTotal` (the lines now) to `landsAt` (what `applyOutcome` — the function
  // the recap panel previews and `applyBidRecap` writes with — says the lines
  // will total). It used to quote `addedTotal`, the markup over DIRECT COST,
  // which is a different number: on the contractor walk (2026-10-27) it said
  // "adds $7,385.00 to the bid" while Apply took typed prices of $34,915.00
  // DOWN to $31,990.50. Typed prices above the recap are ordinary, so the
  // change can go either way and the words say which.
  if (facts.recap && facts.recap.appliedAt === null) {
    return {
      ask: {
        id: "apply-recap",
        step: "price",
        title: "Your markup recap is set up but not on the prices yet.",
        body: applyRecapSentence(facts.bidTotal, facts.recap.landsAt),
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

  // 7b. An addendum not acknowledged on a still-open GC's form (header: PAPER).
  const missingAcks = facts.unacknowledgedAddenda ?? [];
  if (missingAcks.length > 0) {
    const first: GuideAddendumFact = missingAcks[0]!;
    const name = addendumName(first.reference);
    const issued = first.issuedOn ? ` was issued ${spokenDay(first.issuedOn, now)} and` : "";
    const form = first.gcName ? `${possessive(first.gcName)} bid form` : "the bid form";
    const more = missingAcks.length - 1;
    const moreSentence = more > 0 ? ` ${plural(more, "other acknowledgement is", "other acknowledgements are")} missing too.` : "";
    return {
      ask: {
        id: "addendum-unacknowledged",
        step: "proposal",
        title: `${name}${issued} isn't acknowledged on ${form} yet.`,
        body: `A bid form missing an acknowledgement can be thrown out unread. Once it is on the form, record the date in the bid log.${moreSentence}`,
        actions: [
          open("Open the bid log", `${bidLogHrefs("bid").list}#${first.invitationId}`, true),
          open("Read the addendum", `${bidLogHrefs("bid").bidPage(first.invitationId) ?? bidLogHrefs("bid").list}?tab=addenda`),
        ],
      },
      headline: "Priced. One paper needs you.",
      oneLine: lateLine(more > 0 ? `${name} and ${plural(more, "more", "more")} not acknowledged` : `${name} not acknowledged`),
      tone: toneFor("question"),
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
      // Wall runs AND what was measured by hand (facts.ts, "by hand"). The walk
      // of 2026-10-27 read "✓ Walls measured — Done · 1 sheet, none measured
      // yet" with 237 LF of plain measurements on that sheet.
      const hand = facts.handMeasurements;
      const parts: string[] = [];
      if (facts.wallRunCount > 0) parts.push(feet(facts.measuredFootageFt));
      if (hand.lengthFt > 0) parts.push(facts.wallRunCount > 0 ? `${feet(hand.lengthFt)} by hand` : `${feet(hand.lengthFt)} measured by hand`);
      else if (hand.count > 0) parts.push(`${plural(hand.count, "measurement", "measurements")} by hand`);
      if (parts.length > 0) {
        if (facts.openingsCount > 0) parts.push(plural(facts.openingsCount, "opening", "openings"));
        if (facts.sheetCount > 0) parts.push(plural(facts.sheetCount, "sheet", "sheets"));
        return parts.join(" · ");
      }
      if (facts.hasTakeoffPlan) {
        if (facts.sheetCount === 0) return "Drawings uploaded";
        const sheets = plural(facts.sheetCount, "sheet", "sheets");
        // The step reads Done once lines exist (`firstUnfinished`), so "none
        // measured yet" under a tick would contradict itself: say where the
        // lines came from instead.
        return facts.lineCount > 0 ? `${sheets} · lines typed in, nothing measured` : `${sheets}, none measured yet`;
      }
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
      if (guideWasSent(facts)) {
        const sentOn = guideSentOn(facts);
        return sentOn ? `Sent ${monthDay(sentOn)}` : "Sent";
      }
      return dueLabel ? capitalise(dueLabel) : null;
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
