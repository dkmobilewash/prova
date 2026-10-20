/**
 * The one sentence every subcontract-review surface carries — the review, the
 * printed summary and the rider. Written ONCE, here, and rendered only through
 * `components/NotLegalAdvice.tsx`; `subcontractDisclaimerCensus.test.ts` fails
 * the build if the sentence is typed anywhere else or a surface stops rendering
 * the component.
 */
export const SUBCONTRACT_REVIEW_DISCLAIMER = "This is not legal advice. Have an attorney review high-risk terms.";
