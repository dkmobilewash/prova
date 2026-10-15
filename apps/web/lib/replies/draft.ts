import type { OutboundDoor, ReplyClass } from "@prova/db";

/**
 * WHAT THE AGENT IS ALLOWED TO SAY — fixed text per (door, class), no model.
 *
 * The model classifies; it never writes. Every sentence a prospect can receive
 * from the agent is in this file, which is what makes the rule checkable:
 * `replies.test.ts` reads every template and fails on a price, a date, "no
 * strings", and the two terms the study found nobody in the trade uses
 * ("A-1-131", "eCPR"). The only date-shaped thing here is the fixed turnaround
 * per door, which is the offer and not a commitment to a job.
 *
 * THE DISCLOSURE LINE IS ON EVERY MESSAGE, including the ones a person
 * approves, because the agent still wrote it. California's bot law (B&P
 * 17941) reaches public websites and social networks rather than email, and
 * the study's rule is to say it anyway: it removes the intent-to-mislead
 * element at zero cost, and a prospect who learns later that "Cyrus" was a
 * template is the Noom fact pattern.
 */

export const DISCLOSURE = "— sent by C Stream's assistant; Cyrus reads every reply";

/** The three intakes. Fixed turnaround only — never a job date. */
const INTAKE: Record<Exclude<OutboundDoor, "UNKNOWN">, string> = {
  PAY_APP:
    "Send over the contract, the schedule of values and last month's pay app as PDFs, and the name of the GC portal you bill through. You'll have it back by end of tomorrow.",
  CERTIFIED_PAYROLL:
    "A phone photo of one week of timecards plus the job name is all it takes. You'll have the certifieds back by end of tomorrow.",
  TAKEOFF:
    "Send the drawing set as a PDF and the bid due date. You'll have the takeoff back in two days.",
};

/** One paragraph on each door, for SEND_INFO. The offer, not the price. */
const ABOUT: Record<Exclude<OutboundDoor, "UNKNOWN">, string> = {
  PAY_APP:
    "C Stream puts the monthly pay app together for drywall and framing subs — the G702/G703, the schedule of values and the lien releases, built from what you already have, so the GC has nothing to kick back. If you want to see it on your own job, send over one month's paperwork and you'll have the pay app back by end of tomorrow.",
  CERTIFIED_PAYROLL:
    "C Stream turns a week of timecards into the certifieds for a prevailing-wage job — the 347 and the DIR upload, from a phone photo of the timecards. If you want to see it on your own job, send one week plus the job name and you'll have it back by end of tomorrow.",
  TAKEOFF:
    "C Stream does the drywall and framing takeoff from the drawing set, so the bid goes out on time with the quantities checked. If you want to see it on your own bid, send the set as a PDF and the due date and you'll have it back in two days.",
};

export type DraftInput = {
  door: OutboundDoor;
  classification: ReplyClass;
  firstName: string | null;
  /** The month named in a NOT_NOW answer — computed by the caller from the
   *  reply's own date, so this file holds no clock. */
  checkBackMonth: string;
};

export type Draft = { body: string; rationale: string } | { body: null; rationale: string };

export function draftReply(input: DraftInput): Draft {
  const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const sign = (lines: string[]) => [hi, "", ...lines, "", "Cyrus", DISCLOSURE].join("\n");
  const door = input.door === "UNKNOWN" ? null : input.door;

  switch (input.classification) {
    case "INTERESTED":
      if (!door) return { body: null, rationale: "Interested, but the thread does not say which offer — a person picks the intake." };
      return { body: sign([INTAKE[door]]), rationale: `Interested → the ${label(door)} intake.` };
    case "SEND_INFO":
      if (!door) return { body: null, rationale: "Wants information, but the thread does not say which offer." };
      return { body: sign([ABOUT[door]]), rationale: `Wants information → the ${label(door)} paragraph and the offer.` };
    case "NOT_NOW":
      return {
        body: sign([`Understood — I'll check back in ${input.checkBackMonth}.`]),
        rationale: "Not now → acknowledge and name the month.",
      };
    case "WRONG_PERSON":
      return {
        body: sign(["Thanks — who handles this on your side? A name and an email is plenty."]),
        rationale: "Wrong person → ask who. For review, since the right answer may be on the reply itself.",
      };
    case "OUT_OF_OFFICE":
      return { body: null, rationale: "Autoresponder — nothing to answer." };
    case "STOP":
      return { body: null, rationale: "Asked to stop — suppressed, no answer." };
    case "HOSTILE":
      return { body: null, rationale: "Hostile — never answered by the agent." };
    case "QUESTION":
      return { body: null, rationale: "A real question — a person answers it." };
    case "UNCLEAR":
      return { body: null, rationale: "Could not tell what they meant." };
  }
}

function label(door: Exclude<OutboundDoor, "UNKNOWN">): string {
  return { PAY_APP: "pay app", CERTIFIED_PAYROLL: "certified payroll", TAKEOFF: "takeoff" }[door];
}

/** Every sentence the agent can send, for the forbidden-words test. */
export const ALL_TEMPLATE_TEXT: string[] = [...Object.values(INTAKE), ...Object.values(ABOUT), DISCLOSURE];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Two months on from the reply's own date, in UTC like every date here. */
export function checkBackMonth(receivedAt: Date): string {
  return MONTHS[(receivedAt.getUTCMonth() + 2) % 12];
}
