// AIA-style G702/G703 pay application math -- per-line continuation sheet
// figures and the job-level summary certificate. Pure arithmetic,
// deliberately not an LLM call, same reasoning as wip.ts and retainage.ts.
// Not a pixel-exact reproduction of the AIA G702/G703 forms -- the same
// scope decision as certified-payroll.ts: the real substance (scheduled
// value, billed to date, materials stored, retainage, balance to finish)
// without replicating the government/AIA form layout exactly.
//
// "Scheduled value" per line is the line's current contract value
// (quantity x unitPrice) -- already change-order-aware, since an approved
// change order mutates JobLineItem rows directly rather than living in a
// parallel table. See ARCHITECTURE.md.

import { isBlank, parseNumericInput } from "@/lib/numeric-input";

export interface PayAppLineItemInput {
  lineItemId: string;
  description: string;
  scheduledValue: number;
  /** SUM(thisPeriodBilled) from every earlier invoice on this job for this
   * line item, chronologically before the invoice being viewed. */
  previousBilled: number;
  thisPeriodBilled: number;
  /** SUM(materialsStoredValue) from every earlier invoice on this job for
   * this line item. materialsStoredValue is a per-period delta -- what got
   * newly stored (or, entered negative, what got released into billed work)
   * that period -- not a running balance, so the running "materials stored
   * to date" figure has to be summed here the same way previousBilled is.
   * Dropping this was the exact bug a materials-stored line disappeared
   * into on its second pay application: the total looked right for one
   * period and silently lost the earlier stored value on the next. */
  previousMaterialsStored: number;
  materialsStoredValue: number;
}

export interface PayAppLineItemResult extends PayAppLineItemInput {
  /** previousMaterialsStored + materialsStoredValue -- the running stored
   * balance as of this invoice, not just what was entered this period. */
  materialsStoredToDate: number;
  totalCompletedAndStoredToDate: number;
  /** Null when scheduledValue is 0 -- nothing to divide by. */
  percentOfScheduledValue: number | null;
  balanceToFinish: number;
}

export function calculatePayAppLineItem(input: PayAppLineItemInput): PayAppLineItemResult {
  const materialsStoredToDate = input.previousMaterialsStored + input.materialsStoredValue;
  const totalCompletedAndStoredToDate = input.previousBilled + input.thisPeriodBilled + materialsStoredToDate;
  const percentOfScheduledValue =
    input.scheduledValue > 0 ? totalCompletedAndStoredToDate / input.scheduledValue : null;
  const balanceToFinish = input.scheduledValue - totalCompletedAndStoredToDate;

  return {
    ...input,
    materialsStoredToDate,
    totalCompletedAndStoredToDate,
    percentOfScheduledValue,
    balanceToFinish,
  };
}

/** Decimal(12,2) round-tripped through JS numbers: tolerate half a cent so
 * a legitimate exactly-100% entry is not refused by floating-point dust. */
/**
 * "We're at 60% on framing" -> the dollars that belong in This period.
 *
 * THE INVERSE OF `percentOfScheduledValue` ABOVE, and it has to stay
 * exactly that. A sub reports progress as a percentage; the G703 wants a
 * dollar figure in column E. Somebody has been doing that conversion on a
 * calculator, per line, every month — and a calculator does not know what
 * was billed last period, which is the half that goes wrong.
 *
 * THE ROUND TRIP IS THE CONTRACT: feed this result back into
 * `calculatePayAppLineItem` and `percentOfScheduledValue` comes back as
 * the percentage that was asked for. If those two ever disagree, the form
 * shows a different percent complete from the one the person said, on a
 * document that goes to the GC. The test file pins the round trip rather
 * than the arithmetic, because the arithmetic is only correct insofar as
 * it inverts.
 *
 * COMPLETED TO DATE INCLUDES STORED MATERIALS, because that is what the
 * form it feeds means by the column. `percentOfScheduledValue` is
 * `(previousBilled + thisPeriodBilled + materialsStoredToDate) /
 * scheduledValue` — G703 column G over column C — so hitting a stated 60%
 * on a line carrying stored material bills LESS this period than a line
 * without it. That is the G703's own definition and not a choice made
 * here; it is called out because "we're 60% done" said out loud usually
 * means work in place, and on a line with material in the yard those two
 * readings differ by the value of the material.
 *
 * A LOWER PERCENT THAN ALREADY BILLED RETURNS A NEGATIVE, deliberately.
 * That is the downward correction `payAppEntryError` documents at length —
 * over-billed in March, corrected in a later application, the way column E
 * carries it in practice. This function does not refuse it; the bound that
 * matters (you cannot un-bill more than was ever billed) belongs to
 * `payAppEntryError`, which is the single gate every entry already passes
 * through. Duplicating it here would be two rules free to disagree.
 *
 * SO THIS REFUSES ONLY WHAT THAT GATE CANNOT SEE: a percentage that is not
 * a percentage, and a line with no contract value to take a percentage of.
 * Everything else is computed and handed on to be validated.
 */
export interface PercentCompleteInput {
  /** 0-100, NOT a 0-1 ratio. `parseNumericInput` strips a trailing `%` and
   * returns `60` for "60%", which is the form this takes. Passing `0.6`
   * here is not refused — it is a valid "0.6% complete" — so the result
   * carries `percentOfScheduledValue` back for the caller to SHOW. A
   * figure alone can hide that mistake; "this takes the line to 0.6%"
   * cannot. */
  percentComplete: number;
  scheduledValue: number;
  previousBilled: number;
  /** The running stored balance as of this application, i.e.
   * `previousMaterialsStored + materialsStoredValue` — the same
   * `materialsStoredToDate` `calculatePayAppLineItem` derives, passed in
   * rather than re-derived so the two cannot drift. */
  materialsStoredToDate: number;
}

export interface PercentCompleteResult {
  /** What to put in This period. Rounded to the cent the Decimal(12, 2)
   * column stores, BEFORE anything is derived from it — the same ordering
   * `submitPayApplication` uses for the certificate total, and for the
   * same reason: the stored figure and the derived figures must come from
   * one number rather than from a float and its rounding. */
  thisPeriodBilled: number;
  /** Where the line lands once that is entered: completed and stored to
   * date over scheduled value, as a 0-100 percentage. Equal to the
   * requested percent to within a cent's worth of rounding, and the thing
   * to put on screen. */
  landsAtPercent: number;
}

export function thisPeriodForPercentComplete(
  input: PercentCompleteInput,
): { ok: true; result: PercentCompleteResult } | { ok: false; error: string } {
  if (!Number.isFinite(input.percentComplete)) {
    return { ok: false, error: "Percent complete has to be a number." };
  }
  if (input.percentComplete < 0) {
    return {
      ok: false,
      error: `${input.percentComplete}% is not a percent complete. A line that has gone backwards is entered as a lower percent than last time, not as a negative one.`,
    };
  }
  // Over 100 is refused HERE rather than left to payAppEntryError, because
  // that gate reads dollars and would report the overage as a figure the
  // person never typed. "110%" said out loud is a slip worth naming in the
  // words it was said in.
  if (input.percentComplete > 100) {
    return {
      ok: false,
      error: `${input.percentComplete}% is more than the line is worth. Work beyond the contract value belongs on a change order, which becomes its own line once it is approved.`,
    };
  }
  if (!(input.scheduledValue > 0)) {
    return {
      ok: false,
      error:
        "This line has no contract value, so there is no amount to take a percentage of. Bill it as a figure, or price the line first.",
    };
  }

  const completedToDate = round2((input.percentComplete / 100) * input.scheduledValue);
  const thisPeriodBilled = round2(completedToDate - input.previousBilled - input.materialsStoredToDate);
  const landsAtPercent =
    ((input.previousBilled + thisPeriodBilled + input.materialsStoredToDate) / input.scheduledValue) * 100;

  return { ok: true, result: { thisPeriodBilled, landsAtPercent } };
}

/** Money, to the cent the column stores. `Math.round` on a scaled value
 * rather than `toFixed` — `toFixed` returns a string and every caller here
 * wants a number to keep computing with. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CENT_TOLERANCE = 0.005;

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Write-time refusal for one submitted continuation-sheet row. Returns the
 * message to show the person entering it, or null if the entry is fine.
 *
 * Lives here, beside the arithmetic it is derived from, so the refusal and
 * the displayed figures can never disagree. It is deliberately NOT thrown
 * from `calculatePayAppLineItem`: rows already in the database include ones
 * already sent to a GC, and the report page has to keep rendering them
 * whatever they say. The only caller is `submitPayApplication`, which
 * refuses the whole application rather than accepting it in part — a
 * partially-applied pay app is a worse artifact than a rejected one.
 *
 * WHAT THIS DOES NOT DO, because a cap is not a double-bill detector: it
 * catches an entry that drives a line past its scheduled value, which is
 * #95's reproduction, and it catches releasing stored material that was
 * never stored. It cannot catch the same double-count BELOW 100% — store
 * $40k on a $100k line, then bill $50k of installed work without the
 * offsetting negative, and the line reads $90,000 with no refusal
 * anywhere. Nothing in the data distinguishes that from legitimately
 * billing $50k of other work. The defence against that one is the running
 * stored-to-date figure shown beside the input, so the person entering it
 * can see what is sitting there.
 */
export function payAppEntryError(input: PayAppLineItemInput): string | null {
  // A NEGATIVE `thisPeriodBilled` IS A DOWNWARD CORRECTION, AND REFUSING
  // EVERY ONE OF THEM LEFT AN OVER-BILLED LINE UNCORRECTABLE FOREVER.
  //
  // This read `if (input.thisPeriodBilled < 0)` and said the amount "cannot
  // be negative", on the reasoning that the only negative with a mechanism
  // behind it is a stored-materials release. That is true of the RELEASE
  // and false of the CORRECTION, and the two are not the same entry. Bill
  // $60,000 in March against a line where $50,000 was built, with nothing
  // in stored materials, and there was no route back at any later date: the
  // release path needs a stored balance to release, `min="0"` on the form
  // blocked the field, and this line refused a crafted POST. There is no
  // void, edit or delete invoice action in this app, deliberately — an
  // invoice is an evidence record that closes rather than deletes — so a
  // LATER application is the only place March can be corrected.
  //
  // It is also what a G703 does in practice. Column E, "work completed this
  // period", carries the negative and "total completed to date" comes down;
  // the GC's accounting department reconciles the columns and sees the
  // correction on the line it belongs to, which is the whole point of doing
  // it there rather than in a side letter.
  //
  // THE BOUND IS THE PART WORTH ENFORCING: you cannot un-bill work that was
  // never billed. Below zero the line stops being a statement about work
  // and becomes a debt hiding on a schedule of values.
  if (input.previousBilled + input.thisPeriodBilled < -CENT_TOLERANCE) {
    return (
      `${input.description}: taking ${usd(-input.thisPeriodBilled)} back off this period is more than the ` +
      `${usd(input.previousBilled)} ever billed on this line. A correction can only reverse work already ` +
      `billed here — if the GC is owed money for something else, that belongs on its own line or a backcharge.`
    );
  }

  const { materialsStoredToDate, totalCompletedAndStoredToDate } = calculatePayAppLineItem(input);

  if (materialsStoredToDate < -CENT_TOLERANCE) {
    return (
      `${input.description}: releasing ${usd(-input.materialsStoredValue)} of stored materials would leave ` +
      `${usd(materialsStoredToDate)} stored to date — more than has ever been stored on this line ` +
      `(${usd(input.previousMaterialsStored)}).`
    );
  }

  // scheduledValue > 0 is load-bearing. unitPrice is nullable and a
  // cost-only or GC-furnished line legitimately has no contract value, the
  // same "nothing to divide by" case that already makes
  // percentOfScheduledValue null. Without this condition every unpriced
  // line becomes unbillable.
  if (input.scheduledValue > 0 && totalCompletedAndStoredToDate > input.scheduledValue + CENT_TOLERANCE) {
    return (
      `${input.description}: completed and stored to date would be ${usd(totalCompletedAndStoredToDate)} ` +
      `against a scheduled value of ${usd(input.scheduledValue)}. If the stored materials on this line ` +
      `have now been installed, enter the same amount as a NEGATIVE under new materials stored. If the ` +
      `extra work is real, it needs an approved change order raising this line first.`
    );
  }

  return null;
}

/** One submitted continuation-sheet row, before any prior-period context
 * has been looked up for it. */
export interface PayAppSubmittedRow {
  lineItemId: string;
  thisPeriodBilled: number;
  materialsStoredValue: number;
}

/** One cell of the pay-application grid. Blank is zero — most rows on a
 * schedule of values are untouched in any given period — and anything else
 * has to be a figure, said out loud rather than quietly zeroed.
 *
 * Moved here from `submitPayApplication` (#414 wrote it there) so the FORM
 * can read the grid with the same function the action does; the parser
 * itself is #414's and is unchanged. */
function payAppFigure(
  raw: string | undefined,
  label: string,
  options?: { min?: number },
): { ok: true; n: number } | { ok: false; error: string } {
  if (raw === undefined || isBlank(raw)) return { ok: true, n: 0 };
  const parsed = parseNumericInput(raw, { label, maxDecimals: 2, ...options });
  return parsed.ok ? { ok: true, n: parsed.n } : { ok: false, error: parsed.error };
}

/**
 * What the person typed, read out of the posted form.
 *
 * ONE PARSE, USED BY THE ACTION AND BY THE FORM, and that is why it left
 * `lib/actions/billing.ts`. The form has to tell someone their application
 * has gone negative BEFORE they click, and a second expression doing its
 * own reading is a preview free to disagree with what the server decides —
 * the discipline `importCatalogEntries` already follows for a pasted price
 * list. The preview is a courtesy; the server re-reads the raw form.
 *
 * `Number(x) || 0` used to be here and DROPPED LINES IN SILENCE (#414):
 * `12,500` became NaN, then 0, then was filtered out, so an application
 * went to the GC short by a line with nothing saying which. That parser is
 * unchanged, refusals and all.
 *
 * THE ONE THING THAT DID CHANGE IS THE FLOOR. `{ min: 0 }` was on This
 * period, first as `min="0"` in the markup and then as a server rule, on
 * the reasoning that "there is no negative-billing mechanism". That is true
 * of a stored-materials RELEASE and false of a downward CORRECTION — see
 * `payAppEntryError` above, which now carries the bound that replaced it:
 * you cannot un-bill more than the line has been billed.
 *
 * Rows where both fields are blank or zero are dropped. `!== 0` rather than
 * `> 0`: a row whose only content is a negative is the release mechanism
 * (billing.prisma) or a correction, and dropping it re-introduces #95's
 * double bill.
 */
export function payAppRowsFromForm(
  formData: FormData,
): { ok: true; rows: PayAppSubmittedRow[] } | { ok: false; error: string } {
  const lineItemIds = formData.getAll("lineItemId").map(String);
  const thisPeriodValues = formData.getAll("thisPeriodBilled").map(String);
  const materialsStoredValues = formData.getAll("materialsStoredValue").map(String);

  const rows: PayAppSubmittedRow[] = [];
  for (const [i, lineItemId] of lineItemIds.entries()) {
    const billed = payAppFigure(thisPeriodValues[i], "This period");
    if (!billed.ok) return { ok: false, error: billed.error };
    const stored = payAppFigure(materialsStoredValues[i], "Stored materials");
    if (!stored.ok) return { ok: false, error: stored.error };
    if (billed.n === 0 && stored.n === 0) continue;
    rows.push({ lineItemId, thisPeriodBilled: billed.n, materialsStoredValue: stored.n });
  }
  return { ok: true, rows };
}

/** What the GC is asked for on this application: the sum of the breakdown,
 * never a separately-typed number. A pay application's total IS the
 * continuation sheet, so there is nothing to reconcile it against. */
export function payAppTotal(rows: readonly PayAppSubmittedRow[]): number {
  return rows.reduce((sum, row) => sum + row.thisPeriodBilled + row.materialsStoredValue, 0);
}

export interface PayAppSummaryInput {
  lineItems: PayAppLineItemResult[];
  /** SUM(Invoice.retainageWithheld) across every earlier PAY APPLICATION on
   * this job, before the one being viewed. A lump-sum bill is not one — see
   * `isPayApplicationInvoice` in pay-application-query.ts for why both
   * halves of this certificate have to come from the same population. */
  previousRetainageWithheld: number;
  /** This invoice's own Invoice.retainageWithheld snapshot. */
  thisPeriodRetainageWithheld: number;

  /*
   * THERE IS DELIBERATELY NO `retainagePercent` HERE.
   *
   * There was one until now, supplied by every caller and read by nothing —
   * `calculatePayAppSummary` never mentioned it. That is this repo's
   * "written, documented, and never called" shape, in the version of it
   * that costs money rather than the version that is merely untidy: a rate
   * sitting in the input of the function that computes retainage is an open
   * invitation to derive the figure from it live.
   *
   * `Invoice.retainageWithheld` is a SNAPSHOT, taken at creation from the
   * rate in force that period and never recomputed (billing.prisma says
   * so). Change a job from 10% to 5% and a live recomputation would
   * silently restate every certificate already sent to that GC. The
   * snapshots are the only correct source, so the rate has no business
   * being in reach here at all.
   */
}

export interface PayAppSummaryResult {
  contractSumToDate: number;
  totalCompletedAndStoredToDate: number;
  retainageToDate: number;
  totalEarnedLessRetainage: number;
  previousCertificatesForPayment: number;
  currentPaymentDue: number;
  balanceToFinishIncludingRetainage: number;
}

export function calculatePayAppSummary(input: PayAppSummaryInput): PayAppSummaryResult {
  const contractSumToDate = input.lineItems.reduce((sum, item) => sum + item.scheduledValue, 0);
  const totalCompletedAndStoredToDate = input.lineItems.reduce(
    (sum, item) => sum + item.totalCompletedAndStoredToDate,
    0,
  );
  const retainageToDate = input.previousRetainageWithheld + input.thisPeriodRetainageWithheld;
  const totalEarnedLessRetainage = totalCompletedAndStoredToDate - retainageToDate;

  const previousTotalCompletedAndStored = input.lineItems.reduce(
    (sum, item) => sum + item.previousBilled + item.previousMaterialsStored,
    0,
  );
  const previousCertificatesForPayment = previousTotalCompletedAndStored - input.previousRetainageWithheld;

  const currentPaymentDue = totalEarnedLessRetainage - previousCertificatesForPayment;
  const balanceToFinishIncludingRetainage = contractSumToDate - totalEarnedLessRetainage;

  return {
    contractSumToDate,
    totalCompletedAndStoredToDate,
    retainageToDate,
    totalEarnedLessRetainage,
    previousCertificatesForPayment,
    currentPaymentDue,
    balanceToFinishIncludingRetainage,
  };
}
