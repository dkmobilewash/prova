import type { NeedItem } from "@/components/home/HomeParts";
import type { EstimateStage } from "@/lib/estimate-stage";
import type { ProposalPriceState } from "@/lib/estimating/proposal-recap-currency";
import { overdueText } from "@/lib/due-date";

/**
 * WHAT ONE JOB NEEDS FROM A PERSON, in one list, on the job itself.
 *
 * ── THIS IS THE WIDENING `estimate-stage.ts` ASKED FOR ──
 *
 * That module answers "where has the estimate got to, and therefore what has to
 * happen next" for the jobs LIST, and its own header names four things it
 * deliberately does not consult — the bid recap, bid responsiveness, takeoff
 * currency, and any cost figure — ending: *"Widening the function to take those
 * inputs is a real option and a bigger change: it would make a jobs-list cell
 * depend on three more queries per row."*
 *
 * The job PAGE is where those queries are affordable, because it is one job
 * rather than a page of them. So this is not a second opinion about the
 * estimate; it is the first one, with the things a list cell could not pay for.
 *
 * ── IT JUDGES NOTHING ITSELF ──
 *
 * Every item is CALLED rather than re-derived: `estimateStage`,
 * `proposalPriceState`, `takeoffCurrency` and the proposal count each decide
 * their own question, and this orders their answers and writes the sentence. A
 * second implementation of "is the markup stale" would be a second answer, and
 * on the day the two disagreed the one on this screen would be the one somebody
 * acted on.
 *
 * That is also why it takes RESULTS and not rows. A function handed raw line
 * items could re-derive, and would eventually.
 */

export type JobNeedsInput = {
  /** From `estimateStage(lineItemCount, signatureStatuses)`. */
  stage: EstimateStage;
  /**
   * Walls the geometry found and nobody has accepted yet, from
   * `TakeoffWallProposal`. Null when the job has no plan set, which is not the
   * same as zero: zero means somebody has worked through them.
   */
  wallsWaiting: { groups: number; sheets: number } | null;
  /** From `takeoffCurrency(...)`, or null when there is no takeoff. */
  takeoff: { supersededCount: number; measurementsAtRisk: number; unknowableCount: number } | null;
  /** From `proposalPriceState(recap, lineTotal)`, or null with no lines. */
  price: ProposalPriceState | null;
  /** The job's own `bidDueDate`, as stored — UTC midnight, rendered in UTC. */
  bidDueDate: Date | null;
  /** Whether this job is still being bid. A won job's bid date is history. */
  isBidding: boolean;
  /** Midnight today in the viewer's own calendar, so "overdue" matches theirs. */
  today: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How close a bid deadline has to be to reach this list. */
export const BID_DUE_WINDOW_DAYS = 14;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function jobNeeds(input: JobNeedsInput, jobId: string): NeedItem[] {
  const items: NeedItem[] = [];

  // ── 1. THE DEADLINE, FIRST, because it is the only item with a date ──
  //
  // Everything else here is work that can wait a day. A bid cannot, and a bid
  // posted late is worth exactly nothing — so it leads whatever else is wrong.
  // Only while the job is still being bid: once it is won or lost the date is
  // history, and a red row about it would be noise on every job forever.
  if (input.isBidding && input.bidDueDate !== null) {
    const days = Math.round((input.bidDueDate.getTime() - input.today.getTime()) / DAY_MS);
    if (days <= BID_DUE_WINDOW_DAYS) {
      items.push({
        key: `bid-due-${jobId}`,
        tone: days < 0 ? "red" : "amber",
        text: "Get the bid in — the GC's deadline is here",
        when: days < 0 ? overdueText(-days) : days === 0 ? "due today" : `${days} ${plural(days, "day")} left`,
        ...(days < 0 ? { whenTone: "danger" as const } : {}),
        action: { label: "Open", href: `/jobs/${jobId}/estimate` },
      });
    }
  }

  // ── 2. QUANTITIES OFF SUPERSEDED PAPER ──
  //
  // Ahead of the money items on purpose: a markup applied to the wrong
  // quantities is still the wrong number, so the quantities come first. This is
  // one of the four things the jobs list cannot afford to ask.
  if (input.takeoff !== null && input.takeoff.supersededCount > 0) {
    const at = input.takeoff.measurementsAtRisk;
    items.push({
      key: `takeoff-superseded-${jobId}`,
      tone: "red",
      text: `Re-measure ${at} ${plural(at, "quantity", "quantities")} — the drawings they came off have been superseded`,
      when: `${input.takeoff.supersededCount} ${plural(input.takeoff.supersededCount, "plan")}`,
      action: { label: "Open", href: `/jobs/${jobId}/takeoff` },
    });
  }

  // ── 3. THE MARKUP ──
  //
  // `NEVER_APPLIED` and `STALE` are both wrong prices on a document a GC
  // reads, and they are wrong in the direction that loses money: the recap's
  // rates are what turn cost into a bid.
  if (input.price !== null) {
    if (input.price.kind === "NEVER_APPLIED") {
      items.push({
        key: `markup-missing-${jobId}`,
        tone: "red",
        text: "Apply the bid recap — the line prices carry no markup yet",
        when: "nothing added",
        action: { label: "Open", href: `/jobs/${jobId}/estimate` },
      });
    } else if (input.price.kind === "STALE") {
      items.push({
        key: `markup-stale-${jobId}`,
        tone: "amber",
        text: "Re-apply the bid recap — the lines moved after it was applied",
        when: "part marked up",
        action: { label: "Open", href: `/jobs/${jobId}/estimate` },
      });
    }
  }

  // ── 4. WALLS FOUND AND WAITING ──
  //
  // The step the detection deliberately stops before. C Stream finds them; a
  // person decides they are walls and what they are made of, because accepting
  // one writes a quantity somebody bids.
  if (input.wallsWaiting !== null && input.wallsWaiting.groups > 0) {
    const { groups, sheets } = input.wallsWaiting;
    items.push({
      key: `walls-waiting-${jobId}`,
      tone: "amber",
      text: `Check the ${groups} wall ${plural(groups, "group")} found on ${sheets === 1 ? "a sheet" : `${sheets} sheets`}`,
      when: "found, not accepted",
      action: { label: "Open", href: `/jobs/${jobId}/takeoff` },
    });
  }

  // ── 5. WHERE THE ESTIMATE ITSELF HAS GOT TO ──
  //
  // Last, because it is the broadest. `estimateStage` already writes its own
  // instruction, so the sentence is ITS words rather than a paraphrase that
  // could drift from the jobs list.
  //
  // OUT_FOR_SIGNATURE IS OMITTED, and that is the point of this list rather
  // than an oversight. Its own detail reads "Nothing to do here until they
  // sign" — a row that asks for nothing teaches people to stop reading the
  // ones that do.
  if (input.stage.key !== "OUT_FOR_SIGNATURE") {
    items.push({
      key: `stage-${jobId}`,
      tone: input.stage.key === "SIGNED" ? "green" : "amber",
      text: input.stage.detail,
      when: input.stage.label.toLowerCase(),
      action: { label: "Open", href: `/jobs/${jobId}/estimate` },
    });
  }

  return items;
}
