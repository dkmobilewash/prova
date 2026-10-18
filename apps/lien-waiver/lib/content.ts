import type { FormKey, StateCode } from "./statutes/types";

/**
 * EVERY WORD THIS TOOL SAYS ABOUT THE LAW THAT IS NOT THE STATUTE ITSELF.
 *
 * Kept in one file because all of it goes to the attorney, and because
 * `reviewDigest` (lib/statutes/review.ts) hashes this object: reword a
 * meaning and that state's review stops matching until it is looked at
 * again.
 *
 * The house rules for writing here, inherited from C-Stream's own lien
 * waiver feature (apps/web/lib/lien-waiver.ts):
 *
 *   - NEVER say a waiver is safe to sign, correct, compliant, or "all set".
 *     Say what the document does. `content.test.ts` fails the build on the
 *     reassuring phrases.
 *   - Describe; do not advise. "This form releases X" is a description of
 *     the statute's words. "You should sign this" is advice.
 *   - No deadline of any kind is computed or implied.
 */

export const FORM_NAMES: Record<FormKey, string> = {
  CONDITIONAL_PROGRESS: "Conditional waiver — progress payment",
  UNCONDITIONAL_PROGRESS: "Unconditional waiver — progress payment",
  CONDITIONAL_FINAL: "Conditional waiver — final payment",
  UNCONDITIONAL_FINAL: "Unconditional waiver — final payment",
};

/** What each form does, in plain English. The same four sentences for every
 * state because the four forms do the same four jobs; where a state's
 * wording differs in a way that matters, the state's `formNotes` say so. */
export const FORM_MEANINGS: Record<FormKey, string> = {
  CONDITIONAL_PROGRESS:
    "Gives up your lien and bond rights for the work covered by THIS payment, but only once the payment actually reaches you. If the check never clears, the waiver does not take effect. Work after the through date is not covered.",
  UNCONDITIONAL_PROGRESS:
    "States that you HAVE BEEN PAID this progress payment and gives up your lien and bond rights for the work it covers, effective the moment you sign — whether or not the money has arrived.",
  CONDITIONAL_FINAL:
    "Gives up ALL your remaining lien and bond rights on the job, once the final payment actually reaches you. Anything you do not list as an exception or disputed amount is given up too.",
  UNCONDITIONAL_FINAL:
    "States that you HAVE BEEN PAID IN FULL and gives up all your remaining lien and bond rights on the job, effective the moment you sign — whether or not the money has arrived. Anything you do not list as disputed is gone.",
};

/** Said beside the choice of an unconditional form, every time. */
export const UNCONDITIONAL_WARNING =
  "An unconditional waiver says you have been paid, and it counts against you once signed even if you have not been. If the payment has not cleared your bank, the conditional form exists for exactly that.";

/** Said beside any final form. */
export const FINAL_WARNING =
  "A final waiver releases the whole job. Retainage, unapproved change orders and disputed extras that are not written into the form are released with it.";

export interface StateContent {
  name: string;
  slug: string;
  /** The statute prescribing the forms, as cited on the page. */
  statute: string;
  /** How strictly the statute requires its own form, in its own words. */
  formRequirement: string;
  /** Who must sign, in the statute's words. */
  signer: string;
  /** What the statute says about notarization. Every launch state's
   * statute is SILENT on it; that is what is said, and no more. */
  notarization: string;
  /** Anything else on the page about this state, plain English, each one
   * traceable to a section. */
  notes: string[];
  /** Whether the C-Stream header and footer print on this state's PDF --
   * always OUTSIDE the statutory text. Per-state so the attorney can
   * switch it off for a state where they want nothing but the form on the
   * page (attorney question G-3). */
  brandFrame: boolean;
}

export const STATE_CONTENT: Record<StateCode, StateContent> = {
  AZ: {
    name: "Arizona",
    slug: "arizona",
    statute: "A.R.S. § 33-1008",
    formRequirement:
      "A waiver and release is unenforceable unless it \"follows substantially\" one of the four forms in § 33-1008(D).",
    signer: "Signed \"by the claimant or his authorized agent\" (§ 33-1008(A)).",
    notarization: "The statute requires a signature and says nothing about notarization.",
    notes: [
      "A conditional waiver only releases rights once there is evidence of payment — the claimant's endorsement on a check that has cleared, or the claimant's written acknowledgment of payment (§ 33-1008(A)).",
      "The progress-payment forms do not cover retention, pending modifications and changes, or items furnished after the through date. The final forms carry a blank for disputed claims.",
    ],
    brandFrame: true,
  },
  CA: {
    name: "California",
    slug: "california",
    statute: "Cal. Civ. Code §§ 8132–8138",
    formRequirement:
      "A waiver and release does not release the owner, lender or surety unless it is \"in substantially the form provided\" and signed by the claimant (§ 8124(a)).",
    signer: "\"Signed by the claimant\" (§ 8124(a)).",
    notarization: "The statute requires a signature and says nothing about notarization.",
    notes: [
      "A conditional release also needs evidence of payment — the claimant's endorsement on a check that has been paid, or the claimant's written acknowledgment of payment (§ 8124(b)).",
      "The forms carry an Exceptions section. On the progress forms it lists retentions, extras not yet paid for and contract rights — and, on the conditional form, earlier progress payments you gave a conditional waiver for but have not received. On the final forms the only exception is disputed claims for extras.",
    ],
    brandFrame: true,
  },
  NV: {
    name: "Nevada",
    slug: "nevada",
    statute: "NRS 108.2457",
    formRequirement:
      "A waiver and release is unenforceable \"unless it is in the following forms\" (NRS 108.2457(5)) — Nevada's statute does not say \"substantially\".",
    signer: "\"Signed by the lien claimant or the lien claimant's authorized agent\" (NRS 108.2457(1)(a)).",
    notarization: "The statute requires a signature and says nothing about notarization.",
    notes: [
      "If the payment is made by check or draft and it fails to clear, the waiver is deemed null and void whatever the form says (NRS 108.2457(5)(e)).",
      "A conditional waiver releases rights only once the lien claimant receives payment of the amount in it (NRS 108.2457(1)(b)).",
    ],
    brandFrame: true,
  },
  TX: {
    name: "Texas",
    slug: "texas",
    statute: "Tex. Prop. Code § 53.284",
    formRequirement:
      "A waiver and release is unenforceable unless it \"substantially complies\" with the applicable form in § 53.284.",
    signer: "\"Signed by the claimant or the claimant's authorized agent\" (§ 53.281(b)(2)).",
    notarization:
      "The statute requires a signature and says nothing about notarization. § 53.281 was amended effective January 1, 2022 (H.B. 2237).",
    notes: [
      "Nobody may require you to sign an unconditional waiver for a payment unless you have received that payment in good and sufficient funds (§ 53.283).",
      "The unconditional forms must carry the statutory notice at the top, in bold type at least as large as the largest type on the page and not smaller than 10-point (§ 53.284(c), (e)).",
    ],
    brandFrame: true,
  },
};

export const NEW_MEXICO = {
  name: "New Mexico",
  slug: "new-mexico",
  /** What the research established, said once and plainly. */
  finding:
    "New Mexico's lien statute (NMSA 1978, Chapter 48, Articles 2 and 2A) does not prescribe a lien waiver form. It mentions a \"waiver of lien\" — for example at § 48-2A-12 — without setting out its wording, and it says a contingent payment clause is not a waiver of lien rights (§ 48-2-10).",
  consequence:
    "With no statutory form, the form you sign is usually the one in your contract or the one the GC sends. Read its wording closely: there is no statute fixing what it says.",
};
