import { money } from "@/lib/money";

/**
 * The four statutory lien-waiver forms, and the arithmetic that decides
 * what to WARN about before one is signed.
 *
 * Pure. No Prisma, no dates from `now`, no I/O — the caller reads the rows
 * and hands this numbers, the same division as lib/retainage.ts and
 * lib/wip.ts.
 *
 * THE RULE THIS FILE EXISTS UNDER, taken from liens.prisma: THIS APP NEVER
 * SAYS A WAIVER IS SAFE TO SIGN. Nothing here returns "looks good", "no
 * issues" or an all-clear of any kind, and nothing here blocks a save.
 * `waiverWarnings` returns the things worth a second look and an empty
 * array otherwise — and AN EMPTY ARRAY IS NOT AN OPINION. A waiver can be
 * catastrophic for reasons this app cannot see: a side agreement, a
 * second-tier claim, a statute that wants a form we have never heard of.
 * `lien-waiver.test.ts` asserts that no message here ever reassures.
 *
 * WHY WARNINGS AND NOT VALIDATION. Every one of these is a legitimate
 * thing to do on purpose. Subs sign unconditional waivers against payments
 * that have not landed, because the GC will not release the cheque
 * otherwise; subs sign final waivers with retainage outstanding, because
 * the retainage is covered by a separate agreement. Refusing the save
 * would make the app wrong about the world and teach people to route
 * around it. Saying the sentence out loud costs nothing and is the whole
 * value.
 */

export type WaiverCondition = "CONDITIONAL" | "UNCONDITIONAL";
export type WaiverStage = "PROGRESS" | "FINAL";

/**
 * How each form is named on the page.
 *
 * Descriptive, not statutory: these are the plain-English names of the
 * four documents, NOT the titles any particular state's code assigns. The
 * app does not generate statutory wording — `documentUrl` on the model
 * carries the executed form itself, because the GC's form is the GC's
 * form.
 */
export const WAIVER_FORM_LABELS: Record<`${WaiverCondition}_${WaiverStage}`, string> = {
  CONDITIONAL_PROGRESS: "Conditional waiver, progress payment",
  UNCONDITIONAL_PROGRESS: "Unconditional waiver, progress payment",
  CONDITIONAL_FINAL: "Conditional waiver, final payment",
  UNCONDITIONAL_FINAL: "Unconditional waiver, final payment",
};

export function waiverFormLabel(condition: WaiverCondition, stage: WaiverStage): string {
  return WAIVER_FORM_LABELS[`${condition}_${stage}`];
}

/** One line of money the person may want to except, and where it came from. */
export interface ExceptionCandidate {
  key: "retainage" | "pending-change-orders";
  label: string;
  amount: number;
}

export interface ExceptionInput {
  /** Outstanding retainage on the job — `calculateRetainageSummary().balance`. */
  retainageBalance: number;
  /** SUBMITTED change orders: sent to the GC, no decision yet. APPROVED ones
   * are already in the contract value and are not an exception to anything;
   * DRAFT ones have not been asked for. */
  pendingChangeOrderTotal: number;
}

/**
 * What the app can see that a person might want to except — offered
 * BESIDE the field, never written into it.
 *
 * This is the one place the app has an opinion, and the distinction is the
 * whole safety of the feature: a suggestion a person reads and types is a
 * decision they made; a number the app fills in is a decision the app
 * made, on a document that waives money. Only non-zero candidates are
 * returned, because "Retainage: $0.00" beside the field is noise that
 * trains people to stop reading it.
 */
export function candidateExceptions(input: ExceptionInput): ExceptionCandidate[] {
  const candidates: ExceptionCandidate[] = [];
  if (input.retainageBalance > 0) {
    candidates.push({
      key: "retainage",
      label: "Retainage held on this job",
      amount: input.retainageBalance,
    });
  }
  if (input.pendingChangeOrderTotal > 0) {
    candidates.push({
      key: "pending-change-orders",
      label: "Change orders submitted and not yet approved",
      amount: input.pendingChangeOrderTotal,
    });
  }
  return candidates;
}

/** The total of everything `candidateExceptions` found. */
export function candidateExceptionTotal(input: ExceptionInput): number {
  return candidateExceptions(input).reduce((sum, candidate) => sum + candidate.amount, 0);
}

export interface WaiverWarning {
  key: "exceptions-short" | "unconditional-without-payment" | "final-with-retainage";
  message: string;
}

export interface WarningInput extends ExceptionInput {
  condition: WaiverCondition;
  stage: WaiverStage;
  /** What the person actually entered as excepted. */
  exceptedAmount: number;
  /** Payments recorded against the linked invoice. Null when this waiver is
   * not tied to an invoice — the app then has nothing to check and says
   * nothing, rather than warning about an absence it cannot interpret. */
  amountPaid: number | null;
}

/**
 * Everything worth a second look before signing, as sentences.
 *
 * Order is worst-first, because the first line is the one that gets read.
 */
export function waiverWarnings(input: WarningInput): WaiverWarning[] {
  const warnings: WaiverWarning[] = [];

  // A FINAL waiver closes the job's rights. Retainage is, by definition,
  // money not yet paid — so this pairing is the single most expensive
  // thing somebody can do on this screen, and it is worth saying even when
  // the exceptions do cover it, because the amount can change after
  // signing and the waiver cannot.
  if (input.stage === "FINAL" && input.retainageBalance > 0) {
    warnings.push({
      key: "final-with-retainage",
      message:
        `This is a FINAL waiver and ${money(input.retainageBalance)} of retainage is still held on this job. ` +
        `A final waiver releases the job's remaining rights — anything not written into the exceptions goes with it.`,
    });
  }

  // "Unconditional" means "I have been paid", whether or not that is true.
  // Only checkable when an invoice is linked; `null` is silence, not
  // reassurance.
  if (input.condition === "UNCONDITIONAL" && input.amountPaid !== null && input.amountPaid <= 0) {
    warnings.push({
      key: "unconditional-without-payment",
      message:
        "An unconditional waiver states the payment has been received, and no payment is recorded " +
        "against the invoice this is attached to. If the money has not arrived, a conditional waiver " +
        "says the same thing without giving up the claim.",
    });
  }

  const suggested = candidateExceptionTotal(input);
  if (suggested > input.exceptedAmount) {
    const parts = candidateExceptions(input)
      .map((candidate) => `${candidate.label.toLowerCase()} ${money(candidate.amount)}`)
      .join(", and ");
    warnings.push({
      key: "exceptions-short",
      message:
        `Your exceptions total ${money(input.exceptedAmount)}, and this job is carrying ${parts}. ` +
        `Money you do not except here is money this waiver gives up.`,
    });
  }

  return warnings;
}
