// Closeout billing, as facts the app can see. Pure. Nothing here says a job is
// closed out, safe, or owed nothing: each item is what the records show, and a
// missing record reads as "not on file", never as done.

import { money } from "@/lib/money";

const HALF_CENT = 0.005;

/** A retainage release application: no work or material this period, and a
 * negative retainage snapshot giving back what was held. Read off its own rows,
 * because whether an invoice is one is a fact about its figures. */
export function isRetainageReleaseApplication(invoice: {
  retainageWithheld: number | null;
  lines: readonly { thisPeriodBilled: number; materialsStoredValue: number }[];
}): boolean {
  return (
    (invoice.retainageWithheld ?? 0) < -HALF_CENT &&
    invoice.lines.length > 0 &&
    invoice.lines.every((line) => Math.abs(line.thisPeriodBilled) < HALF_CENT && Math.abs(line.materialsStoredValue) < HALF_CENT)
  );
}

/** Final billing: every dollar of the contract billed, and none held back. A
 * conditional FINAL waiver is offered on the application that gets there. */
export function isFinalBilling(summary: {
  contractSumToDate: number;
  totalCompletedAndStoredToDate: number;
  retainageToDate: number;
}): boolean {
  return (
    summary.contractSumToDate > HALF_CENT &&
    summary.totalCompletedAndStoredToDate >= summary.contractSumToDate - HALF_CENT &&
    Math.abs(summary.retainageToDate) < HALF_CENT
  );
}

export type CloseoutItem = { label: string; done: boolean; detail: string };

export interface CloseoutInput {
  /** The newest pay application's certificate, or null when none exists. */
  latest: { number: number; contractSumToDate: number; totalCompletedAndStoredToDate: number } | null;
  /** The job's retainage ledger: withheld on invoices, less releases logged. */
  retainage: { withheld: number; balance: number };
  /** The retainage release application, if one was billed, and what is still
   * unpaid on it. */
  releaseApplication: { number: number; unpaid: number } | null;
  /** Outbound waivers at the FINAL stage, unrevoked. */
  finalWaivers: { condition: "CONDITIONAL" | "UNCONDITIONAL" }[];
  /** Lower-tier parties with no waiver received through the final period. */
  lowerTierMissing: string[] | null;
}

/** The closeout list for one job. Five lines, each a fact or its absence. */
export function closeoutStatus(input: CloseoutInput): CloseoutItem[] {
  const { latest, retainage, releaseApplication, finalWaivers, lowerTierMissing } = input;
  const billedAll = latest ? latest.totalCompletedAndStoredToDate >= latest.contractSumToDate - HALF_CENT && latest.contractSumToDate > HALF_CENT : false;
  const hasConditional = finalWaivers.some((waiver) => waiver.condition === "CONDITIONAL");
  const hasUnconditional = finalWaivers.some((waiver) => waiver.condition === "UNCONDITIONAL");
  const heldNow = Math.max(0, retainage.balance);

  return [
    {
      label: "Contract billed in full",
      done: billedAll,
      detail: !latest
        ? "No pay application yet."
        : billedAll
          ? `Application #${latest.number} reaches ${money(latest.contractSumToDate)}.`
          : `${money(latest.totalCompletedAndStoredToDate)} of ${money(latest.contractSumToDate)} billed through application #${latest.number}.`,
    },
    {
      label: "Retainage billed",
      // The release application's own negative retainage nets the job's withheld
      // total to zero, so a release application is the evidence, not `withheld`.
      done: heldNow < HALF_CENT && (retainage.withheld > HALF_CENT || !!releaseApplication),
      detail:
        heldNow >= HALF_CENT
          ? `${money(heldNow)} still held.`
          : releaseApplication
            ? `Billed on application #${releaseApplication.number}.`
            : retainage.withheld <= HALF_CENT
              ? "No retainage withheld on this job's invoices."
              : "Nothing held on the ledger.",
    },
    {
      label: "Retainage paid",
      done: !!releaseApplication && releaseApplication.unpaid < HALF_CENT,
      detail: !releaseApplication
        ? "Not billed yet."
        : releaseApplication.unpaid < HALF_CENT
          ? `Application #${releaseApplication.number} is paid.`
          : `${money(releaseApplication.unpaid)} unpaid on application #${releaseApplication.number}.`,
    },
    {
      label: "Final waivers issued",
      done: hasUnconditional,
      detail: hasUnconditional
        ? "An unconditional final waiver is on file."
        : hasConditional
          ? "A conditional final waiver is on file. No unconditional one yet."
          : "No final waiver on file.",
    },
    {
      label: "Lower-tier waivers received",
      done: lowerTierMissing !== null && lowerTierMissing.length === 0,
      detail:
        lowerTierMissing === null
          ? "Checked once a final application has a period to."
          : lowerTierMissing.length === 0
            ? "None missing that the app can see, through the final period."
            : `Not on file through the final period: ${lowerTierMissing.join(", ")}.`,
    },
  ];
}
