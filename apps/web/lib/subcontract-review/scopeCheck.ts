import { bidTotals, type BidLineInput } from "@/lib/bid-lines";
import { addendumNumber } from "@/lib/addenda-acknowledgement";
import { addendaListedIn } from "./addendaList";
import { notCarriedKey } from "./keys";

/**
 * THE SCOPE CHECK: the subcontract against OUR side of the deal. Phase 2,
 * section B of the brief. Pure — every comparison here is deterministic code
 * over values that were either read off the contract (and verified to be in a
 * quote) or recorded by a person on the bid and the job. The model contributes
 * only the passages; it never sees a total, never compares two numbers, and
 * never decides what was priced (ARCHITECTURE.md, "the model only narrates").
 *
 * Derived on every read, never stored.
 */

export type ScopeInputs = {
  /** The bid this job was won from — `wonJobId` AND status WON — or null. */
  bid: {
    projectName: string;
    bidAmount: number | null;
    lines: (BidLineInput & { description: string | null })[];
    addenda: { reference: string; acknowledgedOn: Date | null; affectsPricedScope: boolean }[];
  } | null;
  /** The job's own proposal clauses, as they stand now. */
  clauses: { id: string; kind: string; text: string }[];
  jobRetainagePercent: number | null;
  gcDefaultRetainagePercent: number | null;
  /** Σ quantity × unitPrice over live JobLineItems — the job's value. */
  jobLineTotal: number;
  /** Findings from the review, with their verified figures. */
  findings: {
    key: string;
    category: string;
    subtype: string | null;
    quote: string;
    pageStart: number;
    pageEnd: number;
    terms?: { contractSum?: number | null; retainagePercent?: number | null } | null;
  }[];
  scopeChecks: {
    key: string;
    relation: "CONTRADICTS_OUR_CLAUSE" | "CARRIES_OUR_CLAUSE" | "NOT_IN_OUR_PRICED_SCOPE";
    clauseId: string | null;
    clauseKind: string | null;
    clauseText: string | null;
    quote: string;
    pageStart: number;
    pageEnd: number;
    explanation: string;
  }[];
  /** The review read every chunk. A "not carried" claim is only made then. */
  reviewComplete: boolean;
  /** Whether the review was run with scope checking (prompt .2 or later). */
  scopeChecked: boolean;
  pagesRead: number;
  unreadPages: number;
};

export type Cite = { key: string; quote: string; pageStart: number; pageEnd: number };

export type MoneyCheck = {
  contractSum: { value: number; cite: Cite } | null;
  /** The contract states more than one sum — both are shown, neither chosen. */
  conflictingSums: { value: number; cite: Cite }[];
  base: number | null;
  awardedTotal: number | null;
  acceptedAlternates: number;
  undecidedAlternates: string[];
  allowancesCarried: number;
  jobLineTotal: number;
  /** contract − awarded, when both exist. */
  difference: number | null;
  verdict: "MATCHES" | "CONTRACT_HIGHER" | "CONTRACT_LOWER" | "UNKNOWN";
};

export type RetainageCheck = {
  contract: { value: number; cite: Cite } | null;
  job: number | null;
  gcDefault: number | null;
  /** Each a plain sentence, for the screen and the summary. */
  notes: string[];
};

export type AddendaCheck = {
  listed: number[];
  cite: Cite | null;
  /** In the contract, not on our bid at all. */
  notOnOurBid: number[];
  /** On our bid but never acknowledged. */
  notAcknowledged: string[];
  /** Acknowledged by us, not listed in the contract. */
  acknowledgedNotListed: string[];
};

export type ScopeGap = {
  key: string;
  kind: "CONTRADICTS_OUR_CLAUSE" | "NOT_CARRIED" | "NOT_IN_OUR_PRICED_SCOPE";
  title: string;
  /** The contract's words — or, for NOT_CARRIED, OUR clause's words, which is
   *  the one finding that cannot quote the contract (absence has no text). */
  evidence: string;
  evidenceIsOurClause: boolean;
  pageStart: number | null;
  pageEnd: number | null;
  explanation: string;
  clauseText: string | null;
  /** Whether the clause is still on the job (it is snapshotted). */
  clauseStillOnJob: boolean;
};

export type ScopeReport = {
  hasWonBid: boolean;
  money: MoneyCheck;
  retainage: RetainageCheck;
  addenda: AddendaCheck;
  gaps: ScopeGap[];
  /** Why the not-carried list is empty, when it is not because none exist. */
  notCarriedWithheld: string | null;
};

/** Money compared to the cent, because both sides are dollar amounts somebody typed. */
const sameMoney = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

function cite(finding: ScopeInputs["findings"][number]): Cite {
  return { key: finding.key, quote: finding.quote, pageStart: finding.pageStart, pageEnd: finding.pageEnd };
}

export function scopeReport(input: ScopeInputs): ScopeReport {
  return {
    hasWonBid: input.bid !== null,
    money: moneyCheck(input),
    retainage: retainageCheck(input),
    addenda: addendaCheck(input),
    ...gaps(input),
  };
}

export function moneyCheck(input: ScopeInputs): MoneyCheck {
  const sums = input.findings
    .filter((f) => typeof f.terms?.contractSum === "number")
    .map((f) => ({ value: f.terms!.contractSum!, cite: cite(f) }));
  const distinct = sums.filter((s, i) => sums.findIndex((t) => sameMoney(t.value, s.value)) === i);
  const contractSum = distinct.length === 1 ? distinct[0]! : null;

  const totals = input.bid ? bidTotals(input.bid.bidAmount, input.bid.lines) : null;
  const undecidedAlternates = input.bid
    ? input.bid.lines.filter((l) => l.kind === "ALTERNATE" && l.accepted === null).map((l) => l.label)
    : [];
  const awardedTotal = totals && totals.base !== null ? totals.awardedTotal : null;
  const difference = contractSum && awardedTotal !== null ? Math.round((contractSum.value - awardedTotal) * 100) / 100 : null;
  const verdict =
    difference === null ? "UNKNOWN" : sameMoney(difference, 0) ? "MATCHES" : difference > 0 ? "CONTRACT_HIGHER" : "CONTRACT_LOWER";

  return {
    contractSum,
    conflictingSums: distinct.length > 1 ? distinct : [],
    base: totals?.base ?? null,
    awardedTotal,
    acceptedAlternates: totals?.alternatesAccepted ?? 0,
    undecidedAlternates,
    allowancesCarried: totals?.allowancesCarried ?? 0,
    jobLineTotal: input.jobLineTotal,
    difference,
    verdict,
  };
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;

export function retainageCheck(input: ScopeInputs): RetainageCheck {
  const stated = input.findings.filter((f) => typeof f.terms?.retainagePercent === "number");
  const contract = stated.length > 0 ? { value: stated[0]!.terms!.retainagePercent!, cite: cite(stated[0]!) } : null;
  const notes: string[] = [];
  if (!contract) {
    notes.push("The review found no retainage percentage stated in the readable pages.");
  } else {
    if (input.jobRetainagePercent === null) {
      notes.push(`The contract withholds ${pct(contract.value)}; this job has no retainage rate set yet.`);
    } else if (input.jobRetainagePercent !== contract.value) {
      notes.push(
        `The contract withholds ${pct(contract.value)}; this job is set to ${pct(input.jobRetainagePercent)}. ` +
          "Billing will use the job's rate until you change it.",
      );
    }
    if (input.gcDefaultRetainagePercent !== null && input.gcDefaultRetainagePercent !== contract.value) {
      notes.push(`This GC's usual rate on file is ${pct(input.gcDefaultRetainagePercent)}, not ${pct(contract.value)}.`);
    }
    if (stated.some((f) => f.terms!.retainagePercent !== contract.value)) {
      notes.push("The contract states more than one retainage percentage — read each clause.");
    }
  }
  return { contract, job: input.jobRetainagePercent, gcDefault: input.gcDefaultRetainagePercent, notes };
}

export function addendaCheck(input: ScopeInputs): AddendaCheck {
  const listing = input.findings.find((f) => f.subtype === "ADDENDA_LIST" && addendaListedIn(f.quote).length > 0) ?? null;
  const listed = listing ? addendaListedIn(listing.quote) : [];
  const ours = (input.bid?.addenda ?? []).map((a) => ({ ...a, number: addendumNumber(a.reference) }));
  const ourNumbers = new Set(ours.map((a) => a.number).filter((n): n is number => n !== null));
  return {
    listed,
    cite: listing ? cite(listing) : null,
    notOnOurBid: listing ? listed.filter((n) => !ourNumbers.has(n)) : [],
    // With a list: the contract binds you to these and you never acknowledged
    // them. Without one: every unacknowledged addendum on the bid, as context.
    notAcknowledged: ours
      .filter((a) => a.acknowledgedOn === null && (!listing || (a.number !== null && listed.includes(a.number))))
      .map((a) => a.reference),
    acknowledgedNotListed: listing
      ? ours.filter((a) => a.acknowledgedOn !== null && a.number !== null && !listed.includes(a.number)).map((a) => a.reference)
      : [],
  };
}

function gaps(input: ScopeInputs): { gaps: ScopeGap[]; notCarriedWithheld: string | null } {
  const onJob = new Set(input.clauses.map((c) => c.id));
  const out: ScopeGap[] = [];

  for (const check of input.scopeChecks) {
    if (check.relation === "CARRIES_OUR_CLAUSE") continue;
    out.push({
      key: check.key,
      kind: check.relation,
      title:
        check.relation === "CONTRADICTS_OUR_CLAUSE"
          ? `The contract puts on you work your ${check.clauseKind?.toLowerCase() ?? "clause"} excluded`
          : "Work the contract assigns that nothing on your priced list obviously covers",
      evidence: check.quote,
      evidenceIsOurClause: false,
      pageStart: check.pageStart,
      pageEnd: check.pageEnd,
      explanation: check.explanation,
      clauseText: check.clauseText,
      clauseStillOnJob: check.clauseId ? onJob.has(check.clauseId) : false,
    });
  }

  // NOT CARRIED is a claim about the WHOLE contract, so it is withheld unless
  // the whole readable contract was compared. A half-read contract that "does
  // not carry" an exclusion has only not carried it YET.
  let withheld: string | null = null;
  if (!input.scopeChecked) {
    withheld = "This review was run before the scope check existed. Run it again to compare the contract with your clauses.";
  } else if (!input.reviewComplete) {
    withheld = "Which of your exclusions the contract leaves out is shown once the whole contract has been read.";
  } else {
    const carried = new Set(input.scopeChecks.filter((c) => c.relation === "CARRIES_OUR_CLAUSE").map((c) => c.clauseId));
    // A clause the contract CONTRADICTS is already listed, as the stronger
    // statement; listing it again as "not carried" says the same thing twice.
    const contradicted = new Set(input.scopeChecks.filter((c) => c.relation === "CONTRADICTS_OUR_CLAUSE").map((c) => c.clauseId));
    const searched =
      `Searched ${input.pagesRead} readable ${input.pagesRead === 1 ? "page" : "pages"}` +
      (input.unreadPages > 0 ? `; ${input.unreadPages} unread ${input.unreadPages === 1 ? "page was" : "pages were"} not searched.` : ".");
    for (const clause of input.clauses) {
      if (clause.kind !== "EXCLUSION" && clause.kind !== "CLARIFICATION") continue;
      if (carried.has(clause.id) || contradicted.has(clause.id)) continue;
      out.push({
        key: notCarriedKey(clause.id),
        kind: "NOT_CARRIED",
        title: `Your ${clause.kind.toLowerCase()} is not in the subcontract`,
        evidence: clause.text,
        evidenceIsOurClause: true,
        pageStart: null,
        pageEnd: null,
        explanation: `The review found nothing in the subcontract that states this. ${searched} If it is not written into the subcontract, your proposal's terms may not bind the GC.`,
        clauseText: clause.text,
        clauseStillOnJob: true,
      });
    }
  }
  return { gaps: out, notCarriedWithheld: withheld };
}

/**
 * Scope gaps shaped as findings, so the SAME card — the same accept / negotiate
 * / dismiss / note controls, keyed the same way — decides them. A gap is not a
 * finding row, and this does not pretend it is: `evidenceIsOurClause` travels
 * with it so the card can say whose words it is showing.
 */
export const GAP_SEVERITY: Record<ScopeGap["kind"], "HIGH" | "MEDIUM" | "LOW"> = {
  CONTRADICTS_OUR_CLAUSE: "HIGH",
  NOT_CARRIED: "MEDIUM",
  NOT_IN_OUR_PRICED_SCOPE: "LOW",
};

const GAP_POSITION: Record<ScopeGap["kind"], string> = {
  CONTRADICTS_OUR_CLAUSE: "Ask for this work to be struck from the subcontract, or for a change order pricing it, before signing.",
  NOT_CARRIED: "Ask for your exclusions and clarifications to be attached to the subcontract as an exhibit or rider.",
  NOT_IN_OUR_PRICED_SCOPE: "Check whether your estimate covers this; if not, exclude it or price it before signing.",
};

export function gapsAsFindings(
  gaps: readonly ScopeGap[],
  decisions: readonly import("./findings").DecisionView[],
): (import("./findings").ReviewedFinding & { evidenceIsOurClause: boolean })[] {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  return gaps.map((gap) => {
    const decision = byKey.get(gap.key);
    const severity = GAP_SEVERITY[gap.kind];
    return {
      id: gap.key,
      key: gap.key,
      category: "SCOPE",
      subtype: gap.kind,
      severity,
      title: gap.title,
      quote: gap.evidence,
      sourceLabel: gap.evidenceIsOurClause ? "Your proposal" : "Subcontract",
      pageStart: gap.pageStart ?? 0,
      pageEnd: gap.pageEnd ?? 0,
      sectionRef: null,
      explanation: gap.explanation,
      suggestedPosition: GAP_POSITION[gap.kind],
      questionForGc: null,
      status: decision?.decision ?? "OPEN",
      note: decision?.note ?? null,
      effectiveSeverity: decision?.editedSeverity ?? severity,
      effectiveExplanation: decision?.editedExplanation ?? gap.explanation,
      effectivePosition: decision?.editedPosition ?? GAP_POSITION[gap.kind],
      edited: Boolean(decision?.editedSeverity || decision?.editedExplanation || decision?.editedPosition),
      evidenceIsOurClause: gap.evidenceIsOurClause,
    };
  });
}
