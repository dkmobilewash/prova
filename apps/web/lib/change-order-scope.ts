import { Prisma } from "@prova/db";
import { proposalValueDelta, type LineItemForChangeOrder, type ProposalForCalc } from "./change-order";
import { COST_CATEGORIES } from "./actions/shared";

/**
 * What a priced change order request SAYS, as opposed to what it costs.
 *
 * Two things live here, and they are the two halves of the same real
 * document — a PCO a construction manager read out on a recorded
 * walkthrough:
 *
 *   scope sections   what is included, what is EXCLUDED, what was assumed,
 *                    and what the number was figured on
 *   labour breakout  cut-and-install as one line, foreman at a percentage
 *                    of it, stocking and cleanup on its own, materials
 *                    broken out from labour
 *
 * Both are pure. Nothing here reads the database and nothing here is
 * stored — `laborBreakout` recomputes from the proposals every render, for
 * the same reason `changeOrderValueDelta` does: a stored subtotal is a
 * second source of truth for money that disagrees with the lines the first
 * time anyone edits one.
 */

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/* ------------------------------------------------------------------ */
/* The scope sections                                                  */
/* ------------------------------------------------------------------ */

/**
 * In the order they belong on the page, and that order is not cosmetic:
 * included before excluded before qualified is how the document he read
 * out is written, and how every PCO template this repo has seen is
 * written. Exported so the UI cannot invent its own order.
 */
export const SCOPE_NOTE_KINDS = ["INCLUSION", "EXCLUSION", "ASSUMPTION", "PRICING_BASIS"] as const;

export type ScopeNoteKind = (typeof SCOPE_NOTE_KINDS)[number];

export type ScopeNote = {
  id: string;
  kind: ScopeNoteKind;
  text: string;
  sortOrder: number;
};

/**
 * THE HEADINGS ARE THE FEATURE.
 *
 * An exclusion is only worth anything because the document says, in its own
 * words and under its own heading, that the item is not in the price. The
 * same sentence inside a paragraph headed "Scope of work" is the argument
 * you are trying to avoid having. So these strings are what a GC reads, and
 * they are deliberately blunt rather than polite.
 */
export const SCOPE_NOTE_HEADING: Record<ScopeNoteKind, string> = {
  INCLUSION: "Included in this price",
  EXCLUSION: "NOT included — by others",
  ASSUMPTION: "Priced on these assumptions",
  PRICING_BASIS: "How this was figured",
};

/** One line of help under each heading, so the four kinds stay four
 *  different things rather than collapsing into "notes" within a month. */
export const SCOPE_NOTE_HINT: Record<ScopeNoteKind, string> = {
  INCLUSION: "Work this price covers that the priced lines don't spell out.",
  EXCLUSION: "What the GC or another trade has to provide. This is the sentence you quote back later.",
  ASSUMPTION: "A site condition the price depends on. If it turns out otherwise, that's another change order.",
  PRICING_BASIS: "What the number was figured on — quantities, method, the rate used.",
};

export type ScopeSection = {
  kind: ScopeNoteKind;
  heading: string;
  hint: string;
  notes: ScopeNote[];
};

/**
 * The notes split by kind, in document order, with empty kinds dropped.
 *
 * The whole point of this function is that it CANNOT return a section
 * containing a note of another kind — which is the machine-checkable form
 * of "an exclusion is never merged into the scope of work". Sorting is by
 * the authored `sortOrder` first and then by id, so the order is stable
 * rather than whatever the query happened to return.
 */
export function scopeSections(notes: ScopeNote[]): ScopeSection[] {
  return SCOPE_NOTE_KINDS.map((kind) => ({
    kind,
    heading: SCOPE_NOTE_HEADING[kind],
    hint: SCOPE_NOTE_HINT[kind],
    notes: notes
      .filter((note) => note.kind === kind)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
  })).filter((section) => section.notes.length > 0);
}

/**
 * Whether this change order has anything that protects the sub if the GC
 * later argues an item was in the price. Used to nudge a draft that has
 * none, which is the state every change order starts in.
 */
export function hasDefensiveScope(notes: ScopeNote[]): boolean {
  return notes.some((note) => note.kind === "EXCLUSION" || note.kind === "ASSUMPTION");
}

/* ------------------------------------------------------------------ */
/* The labour breakout                                                 */
/* ------------------------------------------------------------------ */

/** Derived from the list the action modules already coerce against, rather
 *  than spelled out again here — a second copy of an enum is a second copy
 *  that stops agreeing the day somebody adds a fifth value. */
export type CostCategory = (typeof COST_CATEGORIES)[number];

export type ProposalForBreakout = ProposalForCalc & {
  id: string;
  description: string | null;
  costCategory: CostCategory | null;
  /** Set only on a foreman-allowance line — see ChangeOrderProposal. */
  foremanPercent: Prisma.Decimal | null;
};

export type ForemanLine = {
  id: string;
  description: string;
  /** What the line was figured at, e.g. 10.00 for "10% of the labour". */
  percent: Prisma.Decimal;
  /** What the line is actually priced at — quantity x unitPrice. */
  amount: Prisma.Decimal;
  /** What that percentage of the base labour comes to, right now. */
  figuredAt: Prisma.Decimal;
};

export type LaborBreakout = {
  /** LABOR lines that are not a foreman allowance — cut and install,
   *  stocking and cleanup, and anything else priced as crew time. */
  laborBase: Prisma.Decimal;
  foremanLines: ForemanLine[];
  /** The foreman allowance as PRICED, summed. Never as re-derived. */
  foreman: Prisma.Decimal;
  /** laborBase + foreman. The subtotal the breakout has to sum to. */
  labor: Prisma.Decimal;
  material: Prisma.Decimal;
  subcontractor: Prisma.Decimal;
  other: Prisma.Decimal;
  /** New lines nobody has said a side for. Its own bucket, never folded
   *  into OTHER — see ChangeOrderProposal.costCategory. */
  uncategorized: Prisma.Decimal;
  /** EDIT and REMOVE proposals: changes to scope that already exists on
   *  the job, which carries no cost category of its own. Kept separate so
   *  the categorised buckets plus this equals the whole change order and
   *  nothing is quietly dropped. */
  adjustments: Prisma.Decimal;
  /** Every bucket above, added up. Equal to changeOrderValueDelta for the
   *  same inputs — asserted in change-order-scope.test.ts, because a
   *  breakout that does not reconcile to the document's own total is a
   *  second set of books. */
  total: Prisma.Decimal;
};

function amountOf(
  proposal: ProposalForBreakout,
  targets: Map<string, LineItemForChangeOrder>,
): Prisma.Decimal {
  return proposalValueDelta(
    proposal,
    proposal.lineItemId ? targets.get(proposal.lineItemId) ?? null : null,
  );
}

/**
 * The priced lines of a change order, grouped the way a PCO presents them.
 *
 * Reuses `proposalValueDelta` rather than multiplying quantity by price
 * again here: there is one rule in this app for what a proposal is worth
 * (including a null unit price being $0 revenue and an unbookable proposal
 * being nothing at all), and a breakout that quietly disagreed with the
 * headline would be worse than no breakout.
 *
 * The foreman handling is the only subtle part. A foreman line is a LABOR
 * line that carries a `foremanPercent`, and it is excluded from
 * `laborBase` — otherwise the allowance would be a percentage of itself.
 * Its `figuredAt` is derived from the base at read time and its `amount`
 * is what the line is actually priced at; `foremanOutOfStep` below is what
 * makes the difference visible instead of silently picking one.
 */
export function laborBreakout(
  proposals: ProposalForBreakout[],
  targets: Map<string, LineItemForChangeOrder>,
): LaborBreakout {
  const added = proposals.filter((p) => p.changeType === "ADD");

  const isForeman = (p: ProposalForBreakout) => p.costCategory === "LABOR" && p.foremanPercent !== null;

  const sum = (rows: ProposalForBreakout[]) =>
    rows.reduce((acc, p) => acc.add(amountOf(p, targets)), ZERO);

  const laborBase = sum(added.filter((p) => p.costCategory === "LABOR" && !isForeman(p)));

  const foremanLines: ForemanLine[] = added.filter(isForeman).map((p) => ({
    id: p.id,
    description: p.description ?? "Foreman",
    percent: p.foremanPercent as Prisma.Decimal,
    amount: amountOf(p, targets),
    figuredAt: laborBase.mul(p.foremanPercent as Prisma.Decimal).div(HUNDRED),
  }));

  const foreman = foremanLines.reduce((acc, line) => acc.add(line.amount), ZERO);

  const material = sum(added.filter((p) => p.costCategory === "MATERIAL"));
  const subcontractor = sum(added.filter((p) => p.costCategory === "SUBCONTRACTOR"));
  const other = sum(added.filter((p) => p.costCategory === "OTHER"));
  const uncategorized = sum(added.filter((p) => p.costCategory === null));
  const adjustments = sum(proposals.filter((p) => p.changeType !== "ADD"));

  const labor = laborBase.add(foreman);

  return {
    laborBase,
    foremanLines,
    foreman,
    labor,
    material,
    subcontractor,
    other,
    uncategorized,
    adjustments,
    total: labor
      .add(material)
      .add(subcontractor)
      .add(other)
      .add(uncategorized)
      .add(adjustments),
  };
}

/**
 * A foreman line priced at something other than the percentage it says it
 * was figured at, phrased for the person about to send the document.
 *
 * This is why the percentage is stored at all. It is NOT used to compute
 * the line — the amount on a change order is an offer, not a formula that
 * re-evaluates after the GC has it — so the two can drift apart when a
 * labour line is added or repriced afterwards, and the sub finds out when
 * the GC does the arithmetic. Null when they agree, or when there is no
 * base labour to take a percentage of.
 *
 * Rounded to cents before comparing: the stored amount has two decimals
 * and the derived one does not, so 10% of $3,333.33 is $333.333 and an
 * exact comparison would report every honest line as wrong.
 */
export function foremanOutOfStep(breakout: LaborBreakout): string[] {
  if (breakout.laborBase.isZero()) return [];
  return breakout.foremanLines
    .filter((line) => !line.figuredAt.toDecimalPlaces(2).equals(line.amount.toDecimalPlaces(2)))
    .map(
      (line) =>
        `${line.description} is priced at ${money(line.amount)}, but ${line.percent.toString()}% of the ${money(breakout.laborBase)} labour is ${money(line.figuredAt)}.`,
    );
}

function money(value: Prisma.Decimal) {
  return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
