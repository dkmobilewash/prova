import { SUBCONTRACT_REVIEW_DISCLAIMER } from "@/lib/subcontract-review/disclaimer";

/**
 * The one disclaimer every subcontract-review surface carries — the review, the
 * printed summary and the rider. The sentence lives in
 * `lib/subcontract-review/disclaimer.ts` and nowhere else;
 * `subcontractDisclaimerCensus.test.ts` holds both halves of that.
 *
 * Shown on paper too (no `print:hidden`): a printed summary handed to a GC or a
 * lawyer must say what it is.
 */
export function NotLegalAdvice({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      data-subcontract-review="not-legal-advice"
      className={`rounded-md border border-line-card bg-tag-amber px-3 py-2 text-sm font-medium text-tag-amber-ink ${className}`}
    >
      {SUBCONTRACT_REVIEW_DISCLAIMER}
    </p>
  );
}
