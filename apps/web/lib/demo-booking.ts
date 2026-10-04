/**
 * The inbound half: somebody asks for a demo, and a slot gets booked.
 *
 * WHY THIS IS INBOUND-ONLY, STATED HERE BECAUSE IT IS A PRODUCT BOUNDARY AND
 * NOT A STAGING DECISION. An artificial voice placing calls to mobile numbers
 * without prior express written consent is TCPA exposure that scales with how
 * well it works, and specialty-trade subcontractors are reachable almost
 * entirely on personal mobiles. A caller who dialled US, or who asked us to
 * ring them back, initiated the contact — a different legal posture and a
 * different impression. Nothing in this module may be used to originate a call
 * to somebody who did not ask for one.
 *
 * THE MODEL NEVER BOOKS. A voice agent's job is to hold a conversation and
 * come back with ANSWERS to the fixed questions below. Whether those answers
 * qualify, which slots exist, and which one gets written are decided here, in
 * code, from data. That is CLAUDE.md's product rule — the arithmetic stays
 * deterministic and the model narrates what it is handed — applied to the one
 * place where a confident wrong answer costs a real meeting on a real calendar.
 *
 * It also makes the thing testable. Every function here is pure and takes its
 * inputs as arguments, so the whole booking path can be exercised with no
 * telephony, no model, and no clock.
 *
 * THE QUESTION SCRIPT IS FIXED, which is the other half of that. An agent that
 * improvises its questions produces answers nobody can score, and two callers
 * who said the same thing get different verdicts. The agent reads these, in
 * this order, and returns what it heard.
 *
 * DATES HERE CARRY A TIME, DELIBERATELY DEPARTING FROM THE UTC-MIDNIGHT RULE.
 * That rule is about calendar DATES — a bid due date, a day worked — where a
 * time component is noise that breaks across timezones. A meeting at 2pm is a
 * real instant on the clock, so a slot is a true `DateTime` and the rendering
 * layer converts it to whoever is looking.
 */

/** The five trades this product is built for. */
export const SERVED_TRADES = [
  "METAL_FRAMING_DRYWALL",
  "LATH_PLASTER",
  "EIFS",
  "ACOUSTICAL_CEILINGS",
  "FIREPROOFING",
] as const;
export type ServedTrade = (typeof SERVED_TRADES)[number];

/**
 * What the agent asks, in order, and nothing else.
 *
 * `required` marks the ones without which there is no point booking: we cannot
 * serve a trade outside the five, and a crew size decides whether this is a
 * product fit or a spreadsheet that works fine. The rest improve the call and
 * do not gate it.
 */
export const INTAKE_SCRIPT = [
  { key: "companyName", ask: "What's the company name?", required: true },
  { key: "contactName", ask: "And who am I speaking with?", required: true },
  {
    key: "trade",
    ask: "What kind of work do you do — drywall and framing, plaster, EIFS, ceilings, fireproofing?",
    required: true,
  },
  {
    key: "crewSize",
    ask: "Roughly how many people do you have in the field?",
    required: true,
  },
  {
    key: "publicWorks",
    ask: "Do you do any public-works or prevailing-wage jobs?",
    required: false,
  },
  {
    key: "statedNeed",
    ask: "What made you reach out — what's the thing that's costing you time right now?",
    required: false,
  },
  {
    key: "callback",
    ask: "What's the best number to reach you on?",
    required: true,
  },
] as const;

export type IntakeKey = (typeof INTAKE_SCRIPT)[number]["key"];

/** What the agent comes back with. Every field optional: a caller can hang up
 *  halfway, and a half-finished intake is a real state rather than an error. */
export interface IntakeAnswers {
  companyName?: string | null;
  contactName?: string | null;
  /** Null means "they said something we could not map to the five" — which is
   *  NOT the same as "they did not say". The distinction decides the verdict. */
  trade?: ServedTrade | null;
  tradeHeard?: string | null;
  crewSize?: number | null;
  publicWorks?: boolean | null;
  statedNeed?: string | null;
  callback?: string | null;
}

export const SERVE_VERDICTS = ["BOOK_IT", "ASK_MORE", "NOT_SERVED"] as const;
export type ServeVerdict = (typeof SERVE_VERDICTS)[number];

export interface Serveability {
  verdict: ServeVerdict;
  /** Said to the caller, so it is a sentence rather than a code. */
  reason: string;
  /** Which required answers are still missing, in script order. */
  missing: IntakeKey[];
}

/**
 * The smallest crew for which this product beats a spreadsheet.
 *
 * NOT a judgement about the business — a two-man outfit is a real contractor.
 * It is a judgement about the product: AIA pay apps, retainage tracking,
 * certified payroll and submittal workflow are the things that hurt at scale,
 * and below this somebody is better served by not paying us. Booking a demo we
 * will lose is worse than saying so on the phone.
 */
export const MIN_CREW = 5;

const REQUIRED_KEYS: IntakeKey[] = INTAKE_SCRIPT.filter((q) => q.required).map(
  (q) => q.key,
);

function present(answers: IntakeAnswers, key: IntakeKey): boolean {
  const value = answers[key as keyof IntakeAnswers];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function serveability(answers: IntakeAnswers): Serveability {
  const missing = REQUIRED_KEYS.filter((key) => !present(answers, key));

  /* A trade we cannot serve is decided FIRST and regardless of what else is
     missing. Collecting a phone number from a plumbing contractor so we can
     tell him no is a waste of his afternoon. `tradeHeard` set with `trade`
     null is the signal: the agent heard a trade and it is not one of ours. */
  if (answers.trade === null && (answers.tradeHeard ?? "").trim().length > 0) {
    return {
      verdict: "NOT_SERVED",
      reason: `We build for wall and ceiling trades — framing and drywall, plaster, EIFS, ceilings, fireproofing. ${answers.tradeHeard!.trim()} isn't one we'd serve well.`,
      missing,
    };
  }

  if (typeof answers.crewSize === "number" && answers.crewSize < MIN_CREW) {
    return {
      verdict: "NOT_SERVED",
      reason: `At ${answers.crewSize} in the field a spreadsheet is probably still cheaper than we are. Worth a call again once the crew grows.`,
      missing,
    };
  }

  if (missing.length > 0) {
    const next = INTAKE_SCRIPT.find((q) => q.key === missing[0])!;
    return { verdict: "ASK_MORE", reason: next.ask, missing };
  }

  return {
    verdict: "BOOK_IT",
    reason: "Served trade, crew big enough for this to pay for itself.",
    missing: [],
  };
}

/* ------------------------------------------------------------------------- *
 * Slots. Computed on every read, never stored as "available".
 * ------------------------------------------------------------------------- */

export interface BookingHours {
  /** 0 = Sunday. Days a demo can land on. */
  weekdays: number[];
  /** Local hour the first slot starts, 24h. */
  startHour: number;
  /** Local hour after which no slot starts. */
  endHour: number;
  minutes: number;
}

/**
 * Deliberately early and deliberately not 9-to-5.
 *
 * These people are on a job site by seven and in a truck at four. A booking
 * window that only offers mid-morning slots is a window that gets declined,
 * and the first thing it would teach them about the product is that it was
 * built by somebody who has never had to be on site.
 */
export const DEFAULT_HOURS: BookingHours = {
  weekdays: [1, 2, 3, 4, 5],
  startHour: 6,
  endHour: 17,
  minutes: 30,
};

/** How soon a slot may be. Nobody books a demo for four minutes from now. */
export const LEAD_TIME_MINUTES = 90;

export interface Slot {
  /** The instant it starts. */
  at: Date;
  minutes: number;
}

/**
 * Every bookable slot in the window, soonest first.
 *
 * Pure: `now`, the busy list and the hours all arrive as arguments, so this is
 * testable against a fixed clock. A slot is bookable when it is inside the
 * hours, far enough ahead, and does not OVERLAP anything already booked —
 * overlap rather than equality, because a 30-minute demo starting 15 minutes
 * into another one is a double-booking that an equality check waves through.
 */
export function slotsFor({
  now,
  days = 5,
  busy = [],
  hours = DEFAULT_HOURS,
}: {
  now: Date;
  days?: number;
  busy?: readonly Slot[];
  hours?: BookingHours;
}): Slot[] {
  const earliest = now.getTime() + LEAD_TIME_MINUTES * 60_000;
  const out: Slot[] = [];

  for (let dayOffset = 0; dayOffset <= days; dayOffset += 1) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    if (!hours.weekdays.includes(day.getUTCDay())) continue;

    for (let hour = hours.startHour; hour < hours.endHour; hour += 1) {
      for (let minute = 0; minute < 60; minute += hours.minutes) {
        const at = new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            hour,
            minute,
          ),
        );
        if (at.getTime() < earliest) continue;
        if (overlapsAny({ at, minutes: hours.minutes }, busy)) continue;
        out.push({ at, minutes: hours.minutes });
      }
    }
  }

  return out;
}

function overlaps(a: Slot, b: Slot): boolean {
  const aStart = a.at.getTime();
  const bStart = b.at.getTime();
  return (
    aStart < bStart + b.minutes * 60_000 && bStart < aStart + a.minutes * 60_000
  );
}

export function overlapsAny(slot: Slot, busy: readonly Slot[]): boolean {
  return busy.some((b) => overlaps(slot, b));
}

export const BOOKING_REFUSALS = ["TOO_SOON", "OUTSIDE_HOURS", "TAKEN"] as const;
export type BookingRefusal = (typeof BOOKING_REFUSALS)[number];

/**
 * Whether a REQUESTED slot can be written.
 *
 * Separate from `slotsFor` on purpose, and this is the function that actually
 * protects the calendar. A voice agent offers three times and the caller picks
 * one; between the offer and the write, somebody else can take it. Re-checking
 * against the list it was offered from would re-approve a stale offer, so this
 * takes the CURRENT busy list and judges again.
 */
export function bookingProblem({
  requested,
  now,
  busy = [],
  hours = DEFAULT_HOURS,
}: {
  requested: Slot;
  now: Date;
  busy?: readonly Slot[];
  hours?: BookingHours;
}): { refusal: BookingRefusal; reason: string } | null {
  if (requested.at.getTime() < now.getTime() + LEAD_TIME_MINUTES * 60_000) {
    return {
      refusal: "TOO_SOON",
      reason: `The soonest we can book is ${LEAD_TIME_MINUTES} minutes out.`,
    };
  }

  const hour = requested.at.getUTCHours();
  if (
    !hours.weekdays.includes(requested.at.getUTCDay()) ||
    hour < hours.startHour ||
    hour >= hours.endHour
  ) {
    return {
      refusal: "OUTSIDE_HOURS",
      reason: "That time is outside the booking window.",
    };
  }

  if (overlapsAny(requested, busy)) {
    return {
      refusal: "TAKEN",
      reason: "That slot has just been taken. Pick another.",
    };
  }

  return null;
}
