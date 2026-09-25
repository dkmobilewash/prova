/**
 * The DAS 140 / DAS 142 rules: deadlines, standing, and what a job owes.
 *
 * Pure arithmetic over values handed in — no database, no session, no React,
 * no clock of its own. Same family as lib/apprentice-ratio.ts,
 * lib/determination-standing.ts and lib/prevailing-wage.ts, and for the same
 * reason: these are the decisions that get quietly wrong, and they are only
 * testable when nothing else is in the way.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHERE THESE RULES CAME FROM, AND HOW FAR TO TRUST THEM
 * ────────────────────────────────────────────────────────────────────────
 *
 * EVERY RULE BELOW WAS LOCATED BY WEB SEARCH AND NOT ONE OF THEM WAS READ
 * OFF A PRIMARY DIR PAGE. Outbound HTTPS to `dir.ca.gov` is blocked from the
 * container this was written in — `WebFetch` returned `EGRESS_BLOCKED` for
 * both `dasapprenticesonpublicworkssummaryofrequirements.htm` and
 * `dasform140.pdf` — so what follows is search-index-attributed text at one
 * remove, cross-read across several sources.
 *
 * FEATURE-AUDIT.md already records this exact failure once: the prevailing-
 * wage determination rule (8 CCR 16000) was "located by web search and not
 * yet clicked through to the primary pages by a human". Repeating that
 * silently is how a known-unverified sentence becomes a fact nobody
 * re-checks, so `DAS_CITATIONS` below is machine-readable, every entry
 * carries `verified: false`, and `das-forms.test.ts` fails the build if one
 * is flipped to true without a primary URL. The screens render the
 * unverified ones as unverified.
 *
 * `DAS_UNVERIFIED_FOR_COUNSEL` is the list a human takes to a staff
 * attorney. It is derived from the citation table, not written twice.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TWO DEADLINES THAT ARE NOT THE SAME KIND OF ARITHMETIC
 * ────────────────────────────────────────────────────────────────────────
 *
 * DAS 140 runs FORWARD from the execution of the contract: ten days, and in
 * no event later than the first day the contractor has workers on the public
 * work. Two bounds, and the EARLIER one governs — which is why
 * `das140Standing` takes the first-worker date and why that date is DERIVED
 * from the timesheets rather than entered. The app already knows when
 * somebody first logged an hour on the job; asking a person to retype it
 * would create a second copy free to disagree with the payroll.
 *
 * DAS 142 runs BACKWARD from the date an apprentice is needed: at least 72
 * hours, excluding Saturdays, Sundays and holidays.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY THE 72-HOUR ANSWER IS DELIBERATELY WEAKER THAN THE RULE
 * ────────────────────────────────────────────────────────────────────────
 *
 * The rule is enforced to the HOUR and it excludes HOLIDAYS. This app holds
 * neither: `neededFrom` and `requestedOn` are plain calendar days stored at
 * UTC midnight (CLAUDE.md's date rule), and there is no California holiday
 * calendar anywhere in this repo and none is being invented here — a
 * hardcoded list of state holidays is a table that silently rots, and it
 * would rot on the one screen that says a deadline has been met.
 *
 * So this module computes `latestSendDayIgnoringHolidays`: the last calendar
 * DAY on which a request could be sent counting back three days and skipping
 * Saturdays and Sundays. Its name says what it ignores, every status that
 * depends on it says `BY_DAY`, and the two things it cannot see are carried
 * as data (`DAS142_LEAD_TIME_CAVEATS`) so a page cannot render the date
 * without them.
 *
 * A holiday can only make the real deadline EARLIER than this one, never
 * later. That asymmetry is the whole reason it is safe to compute at all:
 * the app can say "this is already late" with confidence, and can only ever
 * say "this looks in time, and here is what I could not check".
 *
 * ────────────────────────────────────────────────────────────────────────
 * NO SEQUENCE NUMBER, AND THAT IS A DECISION
 * ────────────────────────────────────────────────────────────────────────
 *
 * WH-347 has a per-job payroll number because the federal form has a
 * "Payroll No." box, so `Wh347PayrollCounter` exists and CLAUDE.md's counter
 * rules apply to it. Neither DAS form has such a box. Minting "DAS-140-0007"
 * and printing it would put a number on a document the state receives that
 * the state never asked for and cannot reconcile — the same class of mistake
 * as inventing a committee address, in a smaller font. So there is no
 * counter, nothing to register in `NUMBERED_TABLES`, and nothing to add to
 * CLAUDE.md's roll-call.
 */

import { formatHours } from "./render-hours";

/* ------------------------------------------------------------------ *
 * Citations
 * ------------------------------------------------------------------ */

/** One rule this module implements, and how well it is known. */
export interface DasCitation {
  /** Stable id, used by the tests and by the screens. */
  key: string;
  /** The rule, in one sentence a contractor would recognise. */
  claim: string;
  /** The governing authority as the secondary sources name it. */
  authority: string;
  /** TRUE only when a human has opened the primary DIR page and read it.
   * `primaryUrl` is then required — see das-forms.test.ts. */
  verified: boolean;
  /** The primary page that would settle it. Present so somebody can click
   * it; its presence is NOT evidence that anybody did. */
  primaryUrl: string;
  /** What a staff attorney is being asked, when this is unverified. */
  question: string;
}

/**
 * Every rule below is `verified: false` on purpose.
 *
 * Flipping one to true is a claim that a person opened `primaryUrl` and read
 * the sentence. `das-forms.test.ts` requires a non-empty `primaryUrl` for a
 * verified entry, which is the floor and not the proof — the proof is a
 * human, and this table is where they record it.
 */
export const DAS_CITATIONS: readonly DasCitation[] = [
  {
    key: "das140-ten-days",
    claim:
      "Contract award information is provided to the applicable committee within ten days of " +
      "execution of the prime contract or subcontract, and in no event later than the first day " +
      "the contractor has workers employed on the public work.",
    authority: "8 CCR 230(a)",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/t8/230.html",
    question:
      "Is the ten days calendar days or working days, and is the first-worker bound really the " +
      "earlier of the two rather than an additional one?",
  },
  {
    key: "das140-recipients",
    claim:
      "A contractor already approved to train sends to the approving committee for the craft in " +
      "the area of the project. A contractor not approved to train sends to ALL applicable " +
      "committees whose geographic area of operation includes the project.",
    authority: "8 CCR 230(a)",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/t8/230.html",
    question:
      "For a signatory sub, is one notice to its own JATC sufficient for a craft, or does the " +
      "obligation also reach other committees covering the same craft and area?",
  },
  {
    key: "das140-not-a-dispatch-request",
    claim: "A DAS 140 is a notification and is NOT a request to dispatch an apprentice.",
    authority: "DIR's DAS 140 form and its instructions",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/das/dasform140.pdf",
    question:
      "Does any box on the current DAS 140 double as a dispatch request, or is a DAS 142 always " +
      "separately required?",
  },
  {
    key: "das140-three-elections",
    claim:
      "The form offers three elections: already approved to train by the committee; will comply " +
      "with that committee's standards for this project; or will be governed by the California " +
      "Apprenticeship Council's regulations.",
    authority: "DIR's DAS 140 form",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/das/dasform140.pdf",
    question:
      "Are these still the three boxes on the current revision, and is more than one ever ticked " +
      "at once?",
  },
  {
    key: "das142-72-hours",
    claim:
      "A request to dispatch an apprentice is in writing and gives the committee at least 72 " +
      "hours' notice, excluding Saturdays, Sundays and holidays, before the day the apprentice " +
      "is required.",
    authority: "8 CCR 230.1(a)",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/t8/230_1.html",
    question:
      "Which holidays are excluded, and is the 72 hours measured from the hour of transmission " +
      "(so a same-day fax at 16:00 counts differently from one at 08:00)?",
  },
  {
    key: "das142-per-craft-per-committee",
    claim: "A separate request goes to each committee, for each craft.",
    authority: "8 CCR 230.1(a)",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/t8/230_1.html",
    question:
      "Must a contractor request from every committee covering the craft and area, or only from " +
      "the one it is approved to train with?",
  },
  {
    key: "threshold-30000",
    claim:
      "The apprenticeship requirements apply to public works contracts of $30,000 or more " +
      "involving an apprenticeable craft.",
    authority: "Labor Code 1777.5",
    verified: false,
    primaryUrl:
      "https://www.dir.ca.gov/das/dasapprenticesonpublicworkssummaryofrequirements.htm",
    question:
      "Is the $30,000 measured on the prime contract, the subcontract, or both — and is it still " +
      "the current figure?",
  },
  {
    key: "ratio-one-to-five",
    claim:
      "The statutory ratio is commonly stated as one hour of apprentice work for every five " +
      "hours of journeyman work, per craft, totalled over the project.",
    authority: "Labor Code 1777.5 / 8 CCR 230.1",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/t8/230_1.html",
    question:
      "Does the 1:5 default apply to us, or does our own program standard govern? NOTHING IN " +
      "THIS APP APPLIES 1:5 — the ratio check uses the rule the company recorded, or reports the " +
      "day unjudgeable.",
  },
  {
    key: "das-no-form-number",
    claim: "Neither form carries a contractor-issued sequence or reference number.",
    authority: "DIR's DAS 140 and DAS 142 forms",
    verified: false,
    primaryUrl: "https://www.dir.ca.gov/das/dasform142.pdf",
    question:
      "Is there any field on either form expecting a contractor's own reference number? This app " +
      "prints none.",
  },
] as const;

/** Every rule a human still has to confirm. Derived, so it cannot drift from
 * the table above — which is what a second hand-written list would do. */
export const DAS_UNVERIFIED_FOR_COUNSEL: readonly DasCitation[] = DAS_CITATIONS.filter(
  (c) => !c.verified,
);

/** The one citation a given screen wants, by key. Throws on an unknown key
 * rather than returning undefined, because a screen rendering nothing where
 * a caveat should be is this repo's most-repeated failure. */
export function dasCitation(key: string): DasCitation {
  const found = DAS_CITATIONS.find((c) => c.key === key);
  if (!found) throw new Error(`No DAS citation named "${key}"`);
  return found;
}

/* ------------------------------------------------------------------ *
 * Days
 * ------------------------------------------------------------------ */

/** `YYYY-MM-DD` — how every date crosses this module's boundary.
 *
 * Strings rather than `Date` objects on purpose: these are plain calendar
 * days stored at UTC midnight, the comparisons are all lexical, and a `Date`
 * invites somebody to call `getDate()` on it in a client component and read
 * the previous day (CLAUDE.md's date rule, and #101). */
export type IsoDay = string;

const DAY_MS = 86_400_000;

/** A calendar day as this app stores it. */
export function dayOf(date: Date): IsoDay {
  return date.toISOString().slice(0, 10);
}

function utc(day: IsoDay): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Days from `from` to `to`, negative when `to` is earlier. */
export function daysBetweenDays(from: IsoDay, to: IsoDay): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** `day` shifted by whole calendar days. */
export function addDays(day: IsoDay, count: number): IsoDay {
  return new Date(utc(day) + count * DAY_MS).toISOString().slice(0, 10);
}

/** Saturday or Sunday, in UTC — which is the zone the day was stored in, so
 * no reader's clock is involved. */
export function isWeekend(day: IsoDay): boolean {
  const weekday = new Date(utc(day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/* ------------------------------------------------------------------ *
 * DAS 140 — the award notice
 * ------------------------------------------------------------------ */

/** Ten days after execution. Calendar days, which is what the secondary
 * sources say and what `das140-ten-days` asks counsel to confirm. */
export function das140TenDayBound(contractExecutedOn: IsoDay): IsoDay {
  return addDays(contractExecutedOn, 10);
}

/**
 * The day the notice is actually due: the EARLIER of ten days after
 * execution and the first day workers were on the job.
 *
 * `firstWorkerOnSiteOn` null means nobody has logged an hour on this job
 * yet, so only the ten-day bound applies — and that is not the same as the
 * bound being unknown.
 */
export function das140DueOn(
  contractExecutedOn: IsoDay,
  firstWorkerOnSiteOn: IsoDay | null,
): { dueOn: IsoDay; bound: "TEN_DAYS" | "FIRST_WORKER" } {
  const tenDays = das140TenDayBound(contractExecutedOn);
  if (firstWorkerOnSiteOn === null || firstWorkerOnSiteOn > tenDays) {
    return { dueOn: tenDays, bound: "TEN_DAYS" };
  }
  return { dueOn: firstWorkerOnSiteOn, bound: "FIRST_WORKER" };
}

export type Das140Status =
  /** Sent, on or before the due day. */
  | "SENT_IN_TIME"
  /** Sent, after the due day. Cannot be fixed by acting sooner; it is a
   * record of what happened. */
  | "SENT_LATE"
  /** Not sent, and the due day has passed. */
  | "OVERDUE"
  /** Not sent, due day still ahead. */
  | "DUE";

export interface Das140Standing {
  status: Das140Status;
  dueOn: IsoDay;
  /** Which of the two bounds set the due day — the sentence on screen says
   * so, because "due the 14th" is unarguable and "due ten days after
   * execution" is checkable. */
  bound: "TEN_DAYS" | "FIRST_WORKER";
  /** Negative when the due day is in the past. Null once sent: the question
   * stops being "how long have I got". */
  daysRemaining: number | null;
  /** How late it went out. Null unless SENT_LATE. */
  daysLate: number | null;
}

export function das140Standing(
  notice: { contractExecutedOn: IsoDay; sentOn: IsoDay | null },
  firstWorkerOnSiteOn: IsoDay | null,
  today: IsoDay,
): Das140Standing {
  const { dueOn, bound } = das140DueOn(notice.contractExecutedOn, firstWorkerOnSiteOn);

  if (notice.sentOn !== null) {
    const late = daysBetweenDays(dueOn, notice.sentOn);
    return late > 0
      ? { status: "SENT_LATE", dueOn, bound, daysRemaining: null, daysLate: late }
      : { status: "SENT_IN_TIME", dueOn, bound, daysRemaining: null, daysLate: null };
  }

  const remaining = daysBetweenDays(today, dueOn);
  return remaining < 0
    ? { status: "OVERDUE", dueOn, bound, daysRemaining: remaining, daysLate: null }
    : { status: "DUE", dueOn, bound, daysRemaining: remaining, daysLate: null };
}

/* ------------------------------------------------------------------ *
 * DAS 142 — the dispatch request
 * ------------------------------------------------------------------ */

/** The two things the lead-time arithmetic below cannot see. Carried as data
 * so no screen can print the date without them. */
export const DAS142_LEAD_TIME_CAVEATS: readonly string[] = [
  "Holidays are NOT excluded — C Stream holds no California holiday calendar. A holiday " +
    "between the send day and the day you need somebody makes the real deadline EARLIER than " +
    "this one, never later.",
  "The rule is counted in hours and this is counted in whole days, because C Stream stores a " +
    "date and not a time. A request sent late on the last day may already be short.",
] as const;

/**
 * The last calendar day a request could be sent: three days back from
 * `neededFrom`, skipping Saturdays and Sundays, and never landing on a
 * weekend itself.
 *
 * Three days rather than "72 hours" because a day is the finest thing this
 * app stores. The name says what it ignores; `DAS142_LEAD_TIME_CAVEATS` says
 * why that is safe in one direction only.
 */
export function latestSendDayIgnoringHolidays(neededFrom: IsoDay): IsoDay {
  let day = neededFrom;
  let counted = 0;
  // Step back one day at a time, counting only the days the rule counts.
  // A loop rather than arithmetic on the weekday index: the arithmetic
  // version is four lines shorter and wrong for two of the seven start days,
  // which is exactly the kind of cleverness a compliance date does not want.
  while (counted < 3) {
    day = addDays(day, -1);
    if (!isWeekend(day)) counted += 1;
  }
  return day;
}

export type Das142Status =
  /** Sent, on or before the latest send day — as far as whole days and no
   * holiday calendar can tell. */
  | "SENT_IN_TIME_BY_DAY"
  /** Sent, after the latest send day. Late whatever the holidays did.  */
  | "SENT_SHORT_NOTICE"
  /** Not sent, and the latest send day has passed. Sending now is already
   * short notice. */
  | "TOO_LATE_TO_SEND"
  /** Not sent, still time. */
  | "DUE"
  /** `neededFrom` is in the past and nothing was ever sent. The deadline
   * cannot be met and the honest word is not "overdue" — the day has gone. */
  | "NEEDED_DAY_PASSED_UNSENT";

export interface Das142Standing {
  status: Das142Status;
  /** Never call this "the deadline" on screen — it ignores holidays and
   * hours. The field name is the reminder. */
  latestSendDay: IsoDay;
  /** Days left to send. Null once sent. */
  daysRemaining: number | null;
  /** How far past the latest send day it went out. Null unless short. */
  daysShort: number | null;
  /** What the committee did, folded in: a request that produced a written
   * "unable to dispatch" is the contractor's defence, and a screen that
   * shows only lateness hides the thing that matters most. */
  outcome: "DISPATCHED" | "UNABLE_TO_DISPATCH" | "NO_RESPONSE" | "NOT_RECORDED";
  /** Always the two caveats. Present on every standing so it cannot be
   * rendered without them. */
  caveats: readonly string[];
}

export function das142Standing(
  request: {
    neededFrom: IsoDay;
    requestedOn: IsoDay | null;
    outcome: "DISPATCHED" | "UNABLE_TO_DISPATCH" | "NO_RESPONSE" | null;
  },
  today: IsoDay,
): Das142Standing {
  const latestSendDay = latestSendDayIgnoringHolidays(request.neededFrom);
  const outcome: Das142Standing["outcome"] = request.outcome ?? "NOT_RECORDED";
  const base = { latestSendDay, outcome, caveats: DAS142_LEAD_TIME_CAVEATS };

  if (request.requestedOn !== null) {
    const short = daysBetweenDays(latestSendDay, request.requestedOn);
    return short > 0
      ? { ...base, status: "SENT_SHORT_NOTICE", daysRemaining: null, daysShort: short }
      : { ...base, status: "SENT_IN_TIME_BY_DAY", daysRemaining: null, daysShort: null };
  }

  if (daysBetweenDays(today, request.neededFrom) < 0) {
    return { ...base, status: "NEEDED_DAY_PASSED_UNSENT", daysRemaining: null, daysShort: null };
  }

  const remaining = daysBetweenDays(today, latestSendDay);
  return remaining < 0
    ? { ...base, status: "TOO_LATE_TO_SEND", daysRemaining: remaining, daysShort: null }
    : { ...base, status: "DUE", daysRemaining: remaining, daysShort: null };
}

/* ------------------------------------------------------------------ *
 * Can this committee be sent to at all
 * ------------------------------------------------------------------ */

/**
 * THE ONE PLACE THAT DECIDES WHETHER A COMMITTEE CAN BE SENT TO.
 *
 * It exists because two screens answered that question differently and both
 * were on `main` at once: lib/das-print.ts tested the JOINED address, which is
 * non-null when only a city (or only a ZIP) is recorded, so a committee with no
 * street line printed as having a complete address with no red sentence —
 * while `ApprenticeshipCommitteePanel` tested `addressLine1` and called the
 * same row undeliverable. On a document the state receives, the print view was
 * the dangerous one: a box that LOOKS filled in is worse than an empty one,
 * because nobody re-checks a filled box, and there is a documented penalty for
 * sending a DAS 142 to the wrong committee.
 *
 * WHAT DELIVERABLE MEANS HERE, and the reason is written down because the
 * next person will be tempted to loosen it:
 *
 *   - POST needs a STREET LINE, a CITY, and a state or a ZIP. A city on its
 *     own is not an address you can post a form to; neither is a ZIP on its
 *     own. Nothing is inferred from the rest — a ZIP does not supply a city
 *     here even though the post office could look one up, because the point of
 *     this table is that the contractor read the address off DIR's own lookup.
 *   - EMAIL or FAX on its own IS enough, and that is not a concession: 8 CCR
 *     230.1 names first class mail, fax and email, so a committee with an
 *     email and no street address is perfectly reachable and must not be
 *     reported as incomplete.
 *   - A blank-but-present string (`" "`) counts as absent, because a space is
 *     what a form field leaves behind.
 *
 * `addressGap` is the sentence for the address box. A committee reachable by
 * email but holding half an address still gets one: the postal box on the form
 * cannot be filled, and printing "Fresno" in it is the failure this function
 * was written for.
 */

/** Exactly the nullable contact set on `ApprenticeshipCommittee`. Nothing
 * here is derived or defaulted. */
export interface CommitteeContact {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  fax: string | null;
}

/** The ways 8 CCR 230.1 names for getting one of these to a committee. */
export type CommitteeChannel = "post" | "email" | "fax";

export interface CommitteeDeliverability {
  /** Every way this committee can actually be reached, in the order a screen
   * lists them. Empty means it cannot be sent to at all. */
  channels: readonly CommitteeChannel[];
  /** `channels.length > 0`, named so a caller reads the question rather than
   * the arithmetic. */
  deliverable: boolean;
  /** The address, joined for print — ONLY when it is complete enough to post.
   * Null whenever it is not, whatever fragments are on file. */
  postalAddress: string | null;
  /** What IS on file when that is not enough to post, joined the same way.
   * Null when nothing at all is recorded, so "half an address" and "no
   * address" stay two different facts. */
  postalOnFile: string | null;
  /** One sentence for the address box on the form, or null when the postal
   * address is complete. Names what is missing rather than that something is. */
  addressGap: string | null;
}

/** A field that is null, empty or whitespace is absent. */
function filled(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The address as it is printed — one line, in postal order. */
function joinAddress(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => p !== null);
  return kept.length > 0 ? kept.join(", ") : null;
}

export function committeeDeliverability(contact: CommitteeContact): CommitteeDeliverability {
  const line1 = filled(contact.addressLine1);
  const line2 = filled(contact.addressLine2);
  const city = filled(contact.city);
  const state = filled(contact.state);
  const postalCode = filled(contact.postalCode);
  const email = filled(contact.email);
  const fax = filled(contact.fax);

  // State and ZIP read as one trailing element on an envelope.
  const region =
    state !== null && postalCode !== null ? `${state} ${postalCode}` : (state ?? postalCode);
  const joined = joinAddress([line1, line2, city, region]);

  const missing: string[] = [];
  if (line1 === null) missing.push("street line");
  if (city === null) missing.push("city");
  if (region === null) missing.push("state or ZIP");
  const postable = missing.length === 0;

  const channels: CommitteeChannel[] = [];
  if (postable) channels.push("post");
  if (email !== null) channels.push("email");
  if (fax !== null) channels.push("fax");

  const addressGap = postable
    ? null
    : (joined === null
        ? "No address is recorded for this committee."
        : `Only “${joined}” is recorded — no ${missing.join(", no ")}.`) +
      " A form cannot be posted to a part of an address, and a plausible-looking address on a" +
      " state form is worse than an empty box. Look the committee up on DIR’s own list and record" +
      " the whole address.";

  return {
    channels,
    deliverable: channels.length > 0,
    postalAddress: postable ? joined : null,
    postalOnFile: postable ? null : joined,
    addressGap,
  };
}

/* ------------------------------------------------------------------ *
 * What a job owes — proposed, never created
 * ------------------------------------------------------------------ */

/**
 * NOTHING IN THIS MODULE CREATES A RECORD, AND THAT IS THE DESIGN.
 *
 * It would be easy to have a job going CONTRACTED write a DAS 140 row for
 * every craft with a committee. It would also be wrong: the row's whole
 * purpose is to say a notice exists, and a notice is a thing a person
 * asserts. This repo's evidence-record rule is that identity is locked after
 * creation and sent correspondence never deletes — a row the app invented
 * and a person then has to unpick is the opposite of that.
 *
 * So the app PROPOSES, in words, with the evidence it reasoned from, and a
 * person clicks. Same shape as the alert engine: raise it, name it, do not
 * act on somebody's behalf.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT A CRAFT IS JOINED BY, AND WHY IT IS NOT THE NAME
 * ────────────────────────────────────────────────────────────────────────
 *
 * A committee's `craftName` is the craft IN THE COMMITTEE'S WORDS
 * ("Drywall/Lathers"), snapshotted onto every notice at creation because that
 * is what the committee was told. A `CraftClassification.name` is the craft in
 * the COMPANY'S words ("Drywall Finisher"). The schema says outright that
 * those routinely differ, which is the entire reason
 * `ApprenticeshipCommittee.craftClassificationId` exists — and for a week
 * nothing used it. Matching the two names instead meant `DAS140_MISSING`
 * never cleared, however many notices went out, and the proposal told the
 * contractor to add a committee that was already in the directory.
 *
 * So the join is the LINK, on both sides:
 *
 *   craft on the job  ──union local of the linked classification──▶  committee
 *   committee  ◀──committeeId──  notice
 *
 * A committee with no link cannot be matched to a craft, and is NOT matched by
 * name as a fallback: a fallback here is the bug wearing a safety net. What it
 * gets instead is a proposal saying the link is missing, which is a thing a
 * person can fix in one click on /union-compliance.
 *
 * WHY THE UNION LOCAL AND NOT THE CLASSIFICATION ITSELF, which is the less
 * obvious half and was measured against a real Postgres rather than reasoned
 * about. `CraftClassification` is unique on `(unionLocalId, name)`, so a
 * trade's journeyman tier and its apprentice tier are two SEPARATE
 * classification rows — and `ApprenticeshipCommittee.craftClassificationId` is
 * a single optional FK, so one committee row can be linked to exactly one of
 * them. Matching on the classification exactly would therefore raise "no
 * committee is linked to this craft" on the apprentice-tier row of every trade,
 * forever: the contractor cannot link the same committee twice, because
 * `createApprenticeshipCommittee` refuses a duplicate name/craft/area. That is
 * the un-clearable-item failure this file was just corrected for, arriving from
 * the other side.
 *
 * The union local is the only id this app holds for "the trade" — it is what
 * `apprentice-ratio.ts` groups a ratio by, for the same reason. The cost is
 * stated rather than hidden: a company running two genuinely different trades
 * under ONE local gets one committee's link covering both, so a notice missing
 * for the second trade is not proposed. That is a quieter engine, not a wrong
 * claim — nothing here ever says a job owes nothing — and it is the trade this
 * app can make honestly with the ids it has.
 *
 * ────────────────────────────────────────────────────────────────────────
 * HOW MANY NOTICES AN AWARD OWES IS A QUESTION THIS FUNCTION DECLINES
 * ────────────────────────────────────────────────────────────────────────
 *
 * 8 CCR 230(a), as the secondary sources read it, sends a contractor already
 * approved to train to the APPROVING committee and one not approved to ALL
 * applicable committees in the area. `approvedToTrainUs` is therefore
 * load-bearing — and it is three-valued, because a null is nobody having
 * recorded it.
 *
 * Two reasons this function does not turn that into a count. The blank is
 * one: defaulting it either way produces a confident wrong number on a
 * compliance screen. The bigger one is `das140-recipients` in
 * `DAS_CITATIONS`, which is `verified: false` — whether one notice to a
 * signatory's own JATC discharges the craft is exactly the question nobody has
 * put to counsel yet. So `DAS140_MISSING` is raised as an OBSERVATION per
 * committee ("no DAS 140 is recorded to this one"), never as "you owe this
 * many", and when the directory cannot settle the count
 * `DAS140_RECIPIENTS_UNKNOWN` says so out loud instead of guessing.
 */

export type DasProposalKind =
  /** Public works, contracted, a craft is on the job, and a committee linked
   * to that craft has no DAS 140 recorded on this award. */
  | "DAS140_MISSING"
  /** A DAS 140 exists but has never been marked sent. Raised from the notices
   * themselves, so it appears in the ten days after execution — before
   * anybody has logged an hour, which is most of that window. */
  | "DAS140_UNSENT"
  /** More than one committee covers a craft and the directory does not say
   * which of them this award has to notify. */
  | "DAS140_RECIPIENTS_UNKNOWN"
  /** Journeyman hours are being logged on a craft and no apprentice hours
   * are, and no dispatch request is on file for that craft. */
  | "DAS142_NO_APPRENTICES"
  /** A DAS 142 exists, is unsent, and its latest send day has passed. */
  | "DAS142_UNSENT_AND_LATE"
  /** Hours are logged that nobody has tagged to a craft. Not an obligation —
   * an obligation cannot be worked out until they are tagged. */
  | "HOURS_WITHOUT_CRAFT";

export interface DasProposal {
  kind: DasProposalKind;
  /** The craft this is about, in the words the evidence used. */
  craftName: string;
  /** One sentence naming what was observed. Never an instruction dressed as
   * a fact: "0 apprentice hours against 184 journeyman hours" is checkable,
   * "you are out of ratio" is a verdict this function is not entitled to. */
  observed: string;
  /** What the contractor can do about it. */
  suggestion: string;
  /** The existing record this is about, when there is one. */
  recordId: string | null;
}

export interface DasObligationInput {
  /** From the job's Compliance tab. Null means NOBODY HAS RECORDED whether
   * this is public works, which is not "no". */
  publicWorks: boolean | null;
  /** A job still at ESTIMATE has no award to notify anybody about. */
  contracted: boolean;
  /** Crafts with hours logged on this job, and how those hours split. Comes
   * from the same TimeEntry rows lib/apprentice-ratio.ts reads. */
  crafts: readonly {
    /** The company's own classification these hours are tagged to, or NULL
     * for the untagged pseudo-row. A null is not a craft: it owes nothing to
     * anybody, because there is nobody it could be owed to. */
    craftClassificationId: string | null;
    /** That classification's union local — what a committee is matched on. */
    unionLocalId: string | null;
    craftName: string;
    journeymanHours: number;
    apprenticeHours: number;
    /** Hours on a classification with no tier recorded. Never counted as
     * journeyman hours — same rule as the ratio check, for the same reason:
     * a half-configured company must not be told it is fine. */
    unclassifiedHours: number;
  }[];
  /** Committees this company has recorded. `unionLocalId` — the local of the
   * classification this committee is LINKED to — is the join; `craftName` is
   * only ever used for wording. */
  committees: readonly {
    id: string;
    name: string;
    craftName: string;
    craftClassificationId: string | null;
    unionLocalId: string | null;
    approvedToTrainUs: boolean | null;
  }[];
  notices140: readonly {
    id: string;
    committeeId: string;
    craftName: string;
    sentOn: IsoDay | null;
  }[];
  requests142: readonly {
    id: string;
    committeeId: string;
    craftName: string;
    neededFrom: IsoDay;
    requestedOn: IsoDay | null;
  }[];
  today: IsoDay;
}

/** The approval state as a clause, said out loud rather than folded into a
 * count. All three values are sayable; the third one especially. */
function approvalClause(approved: boolean | null): string {
  if (approved === true) return "recorded as having approved you to train";
  if (approved === false) return "recorded as not having approved you to train";
  return "not recorded whether they approved you to train";
}

export function dasProposals(input: DasObligationInput): DasProposal[] {
  // Not public works, or nobody has said: propose nothing. A DAS 140 on a
  // private job is a notice to a committee about work it has no jurisdiction
  // over, and a null publicWorks is the app not knowing — which is exactly
  // when it should stay quiet rather than guess.
  if (input.publicWorks !== true) return [];
  if (!input.contracted) return [];

  const out: DasProposal[] = [];
  const committeeById = new Map(input.committees.map((c) => [c.id, c]));
  // Keyed on the COMMITTEE, not on the craft. Keyed on the craft, two
  // committees covering one craft collapsed to one entry, so one notice
  // suppressed the proposal for both of them.
  const noticedCommittees = new Set(input.notices140.map((n) => n.committeeId));

  /** Locals a request has already reached, via the committee it went to. */
  const requestLocals = new Set(
    input.requests142
      .map((r) => committeeById.get(r.committeeId)?.unionLocalId ?? null)
      .filter((id): id is string => id !== null),
  );
  const unlinkedRequests = input.requests142.filter(
    (r) => (committeeById.get(r.committeeId)?.unionLocalId ?? null) === null,
  ).length;

  // Hours grouped by TRADE — the union local, per the header. One proposal per
  // trade and committee rather than per classification: a trade's journeyman
  // and apprentice tiers are separate classification rows, and raising the same
  // committee twice for the same award is noise a person learns to scroll past.
  type Trade = { craftNames: string[]; journeymanHours: number; apprenticeHours: number };
  const byTrade = new Map<string, Trade>();

  for (const craft of input.crafts) {
    // THE UNTAGGED PSEUDO-ROW IS NOT A CRAFT. It cannot owe a notice to a
    // committee, because no committee can be linked to "no craft tag" — which
    // is why it used to produce "add the apprenticeship committee for this
    // craft and area first" as an item nothing could ever clear. What it does
    // produce is the fact underneath it, and tagging the hours clears that.
    if (craft.craftClassificationId === null) {
      const total = craft.journeymanHours + craft.apprenticeHours + craft.unclassifiedHours;
      if (total <= 0) continue;
      out.push({
        kind: "HOURS_WITHOUT_CRAFT",
        craftName: craft.craftName,
        observed:
          `${formatHours(total)} hours on this job are not tagged to any craft, so C Stream cannot ` +
          `tell which crafts this award has to notify a committee about.`,
        suggestion:
          "Tag those hours to a craft on Hours. Until they are, they count towards no craft's " +
          "notices — and there is no committee that trains for “no craft tag”, so nothing here " +
          "can be sent on their account.",
        recordId: null,
      });
      continue;
    }

    // A classification always has a local; the fallback key keeps a caller that
    // somehow has one without it in its own group rather than silently merged.
    const key = craft.unionLocalId ?? `craft:${craft.craftClassificationId}`;
    const trade = byTrade.get(key) ?? { craftNames: [], journeymanHours: 0, apprenticeHours: 0 };
    const hours = craft.journeymanHours + craft.apprenticeHours + craft.unclassifiedHours;
    if (hours > 0 && !trade.craftNames.includes(craft.craftName)) trade.craftNames.push(craft.craftName);
    trade.journeymanHours += craft.journeymanHours;
    trade.apprenticeHours += craft.apprenticeHours;
    byTrade.set(key, trade);
  }

  for (const [localId, trade] of byTrade) {
    if (trade.craftNames.length === 0) continue;
    const label = trade.craftNames.join(" and ");
    const linked = input.committees.filter((c) => c.unionLocalId === localId);

    if (linked.length === 0) {
      out.push({
        kind: "DAS140_MISSING",
        craftName: label,
        observed:
          `Hours are logged on ${label} and no committee in your directory is linked to that ` +
          `trade, so C Stream cannot tell who a DAS 140 for it would go to.`,
        suggestion:
          input.committees.length === 0
            ? "Look the committee up on DIR’s own list for this craft and area, record it on Union " +
              "compliance, and link it to this classification — then start the notice."
            : "If one of the committees you have already recorded covers this craft, open Union " +
              "compliance and set its classification to this one: C Stream matches on that link, " +
              "not on the wording, because a committee’s own craft name routinely differs from " +
              "yours. If none of them covers it, look the committee up on DIR and add it.",
        recordId: null,
      });
    } else {
      const withoutNotice = linked.filter((c) => !noticedCommittees.has(c.id));
      for (const committee of withoutNotice) {
        out.push({
          kind: "DAS140_MISSING",
          craftName: label,
          observed:
            `Hours are logged on ${label} and no DAS 140 is recorded on this job to ` +
            `${committee.name}, which covers it — ${approvalClause(committee.approvedToTrainUs)}.`,
          suggestion:
            "If this award has to notify that committee, record the DAS 140 you sent it, or start " +
            "one and send it.",
          recordId: null,
        });
      }

      // The count question, and the honest answer to it. Only worth raising
      // while something is actually missing: if every linked committee has a
      // notice, nothing turns on how many were owed.
      if (
        withoutNotice.length > 0 &&
        linked.length > 1 &&
        linked.some((c) => c.approvedToTrainUs === null)
      ) {
        const unrecorded = linked.filter((c) => c.approvedToTrainUs === null);
        out.push({
          kind: "DAS140_RECIPIENTS_UNKNOWN",
          craftName: label,
          observed:
            `${linked.length} committees in your directory cover ${label}, and for ` +
            `${unrecorded.map((c) => c.name).join(" and ")} it is not recorded whether they have ` +
            `approved you to train. How many notices this award owes for this craft turns on that, ` +
            `so C Stream is not going to tell you a number.`,
          suggestion:
            "Record, on Union compliance, whether each of those committees has approved you to " +
            "train. Even then: whether one notice to your own committee covers the craft, or every " +
            "committee in the area gets one, is on the list of rules C Stream has NOT confirmed " +
            "against DIR — ask counsel before you rely on either reading.",
          recordId: null,
        });
      }
    }

    // The DAS 142 side. Deliberately NOT a ratio verdict: this counts hours
    // and says what it counted. Applying 1:5 here would be this app asserting
    // a statutory ratio it has not verified (see `ratio-one-to-five`), and
    // lib/apprentice-ratio.ts already refuses to judge a day it cannot.
    //
    // Counted over the TRADE rather than the classification, for the reason
    // the header gives: apprentice hours are logged against an apprentice-tier
    // classification, which is a different row from the journeyman one, so a
    // per-classification count reads zero apprentice hours on every journeyman
    // craft — an item that fires on every public-works job forever.
    if (trade.journeymanHours > 0 && trade.apprenticeHours === 0 && !requestLocals.has(localId)) {
      out.push({
        kind: "DAS142_NO_APPRENTICES",
        craftName: label,
        observed:
          `${formatHours(trade.journeymanHours)} journeyman hours and no apprentice hours are ` +
          `logged on ${label}, and no dispatch request is on file for it.`,
        suggestion:
          "If this craft is apprenticeable, a DAS 142 is how you ask for an apprentice — and a " +
          "committee that cannot dispatch one is the record that says you asked." +
          (unlinkedRequests > 0
            ? " If you have already asked: C Stream matches a request to a craft through the" +
              " committee’s classification link, and " +
              `${unlinkedRequests} of your requests is on a committee with no link.`
            : ""),
        recordId: null,
      });
    }
  }

  // The notices' OWN loop, the shape the DAS 142 side already had. An unsent
  // notice was previously only noticed from inside the crafts loop, so a
  // notice recorded the day the contract was executed raised nothing at all
  // until somebody logged an hour — and the ten days it has to go out in are
  // usually over before anybody does.
  for (const notice of input.notices140) {
    if (notice.sentOn !== null) continue;
    const committee = committeeById.get(notice.committeeId);
    out.push({
      kind: "DAS140_UNSENT",
      craftName: notice.craftName,
      observed:
        `A DAS 140 for ${notice.craftName}${committee ? ` to ${committee.name}` : ""} is recorded ` +
        `on this job and has never been marked sent.`,
      suggestion: "Print it, send it to the committee, then record the date and how it went.",
      recordId: notice.id,
    });
  }

  for (const request of input.requests142) {
    if (request.requestedOn !== null) continue;
    if (latestSendDayIgnoringHolidays(request.neededFrom) >= input.today) continue;
    out.push({
      kind: "DAS142_UNSENT_AND_LATE",
      craftName: request.craftName,
      observed:
        `A DAS 142 for ${request.craftName} wants somebody from ${request.neededFrom} and has ` +
        `never been marked sent. The latest send day has passed.`,
      suggestion:
        "Send it anyway and record the date — a short-notice request on file is worth more than " +
        "no request. Then move the date you need somebody, if you can.",
      recordId: request.id,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * How the statuses read
 * ------------------------------------------------------------------ */

/**
 * The words on screen, here rather than in a component, so a test can pin
 * them and two screens cannot say different things about the same status.
 *
 * Read out loud rather than as a chip, which is the call
 * `ApprenticeshipPanel`'s `StandingNote` already made on the screen beside
 * this one: "OVERDUE" next to a blank cell cannot be told apart from "nobody
 * recorded it", and those are different conversations.
 */
export const DAS140_STATUS_LABEL: Record<Das140Status, string> = {
  SENT_IN_TIME: "sent in time",
  SENT_LATE: "sent late",
  OVERDUE: "not sent — the deadline has passed",
  DUE: "not sent yet",
};

export const DAS142_STATUS_LABEL: Record<Das142Status, string> = {
  SENT_IN_TIME_BY_DAY: "sent with the lead time, by day count",
  SENT_SHORT_NOTICE: "sent on short notice",
  TOO_LATE_TO_SEND: "not sent — sending now is already short notice",
  DUE: "not sent yet",
  NEEDED_DAY_PASSED_UNSENT: "never sent, and the day you needed somebody has passed",
};

export const DAS142_OUTCOME_LABEL: Record<Das142Standing["outcome"], string> = {
  DISPATCHED: "an apprentice was dispatched",
  UNABLE_TO_DISPATCH: "the committee could not dispatch anybody",
  NO_RESPONSE: "no reply came back",
  NOT_RECORDED: "nothing recorded about a reply",
};

export const DAS_METHOD_LABEL: Record<string, string> = {
  FIRST_CLASS_MAIL: "first class mail",
  FAX: "fax",
  EMAIL: "email",
  HAND_DELIVERED: "by hand",
};

/** Green / amber / rose, as the rest of the compliance screens use them. A
 * status that reads as a problem must never be green, which is the one thing
 * a test can check about a colour here. */
export const DAS140_STATUS_TONE: Record<Das140Status, string> = {
  SENT_IN_TIME: "text-tag-green-ink",
  SENT_LATE: "text-tag-rose-ink",
  OVERDUE: "text-tag-rose-ink",
  DUE: "text-tag-amber-ink",
};

export const DAS142_STATUS_TONE: Record<Das142Status, string> = {
  SENT_IN_TIME_BY_DAY: "text-tag-green-ink",
  SENT_SHORT_NOTICE: "text-tag-rose-ink",
  TOO_LATE_TO_SEND: "text-tag-rose-ink",
  DUE: "text-tag-amber-ink",
  NEEDED_DAY_PASSED_UNSENT: "text-tag-rose-ink",
};
