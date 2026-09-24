import { calculateRetainageSummary } from "@/lib/retainage";

/**
 * The figures the retainage count-up draws, and the arithmetic that produces
 * them. A plain module, deliberately — RetainageCountUp.tsx is "use client",
 * and a non-component export from a client module does not survive the RSC
 * boundary: the server gets a client-reference proxy where the value should
 * be, which typechecks perfectly and is not a number at runtime. That cost a
 * production 500 on /sales/[id] (lib/client-boundary.test.ts has the story),
 * and that census is what sent this file here. Same split as
 * AskDemo.tsx / askDemoScript.ts.
 *
 * WHY THE NUMBERS ARE WHAT THEY ARE. They are illustrative per-invoice
 * retainage snapshots on the made-up job every landing-page drawing uses, and
 * they are NOT free: they sum to the "Retainage to date" that
 * PayApplicationPanel computes for the same job, so the two drawings in that
 * section cannot tell a visitor two different things. RetainageCountUp.test.ts
 * renders both and compares them, and that test fails if either side moves.
 *
 * `PREVIOUS_APPLICATIONS` stands for the three earlier pay applications
 * summed, which is how the pay application panel models them too — this
 * drawing shows no per-invoice rows, so their split is not drawn and is not
 * invented. `RELEASED` is one logged `RetainageRelease`: a GC releasing
 * retainage on a completed scope. Nothing here multiplies by a retainage rate;
 * the withheld amount on an invoice is a snapshot taken when it was created,
 * and lib/billing/retainage-amount.ts is the only place that computes one.
 */
const PREVIOUS_APPLICATIONS = 23_606.0;
const THIS_APPLICATION = 13_364.5;
const RELEASED = 12_000.0;

/** Withheld, released and the balance — `calculateRetainageSummary`, the same
 * function the Retainage tab calls. */
export const RETAINAGE_DRAWING = calculateRetainageSummary({
  invoiceRetainageWithheld: [PREVIOUS_APPLICATIONS, THIS_APPLICATION],
  releaseAmounts: [RELEASED],
  substantialCompletionDate: null,
});

/** How long the number takes to arrive. The bar shares it: the same value is
 * `--landing-countup-duration` in globals.css, and the two are meant to land
 * together. There is no way to share one number between a stylesheet and a
 * module, so they are named in each other's comments instead. */
export const COUNT_MS = 1300;
