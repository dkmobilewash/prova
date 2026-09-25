import Link from "next/link";

import type { JobTakeoffCurrency } from "@/lib/takeoff-currency-query";

/**
 * "These quantities came off drawings that have since been superseded."
 *
 * ABOVE the measurements, for the same reason the levelling caution sits
 * above the quotes: it is the thing that decides whether the numbers below it
 * mean anything. A warning under a list of figures is a warning read after
 * the figures have already been believed.
 *
 * NOTHING HERE OFFERS TO FIX IT, and that is the feature rather than a gap.
 * The app cannot see what moved on the new sheet — a corridor shifting two
 * feet changes a length by an amount only a person looking at both drawings
 * can know. A "re-quantify" button would produce a guess shaped exactly like
 * a measurement. See `lib/takeoff-currency.ts`.
 *
 * A server component: it renders text and one link, and holds no state.
 */
export function TakeoffCurrencyBanner({
  jobId,
  currency,
}: {
  jobId: string;
  currency: JobTakeoffCurrency;
}) {
  const superseded = currency.plans.filter((plan) => plan.state === "SUPERSEDED");
  const unknowable = currency.plans.filter((plan) => plan.state === "UNKNOWABLE");

  if (!currency.headline && currency.undated.length === 0) return null;

  const urgent = currency.supersededCount > 0;

  return (
    <div
      className={`rounded-lg border p-3 ${
        urgent ? "border-tag-amber-ink/40 bg-amber-500/5" : "border-line-row bg-surface-card"
      }`}
    >
      {currency.headline && (
        <p className={`text-sm ${urgent ? "text-tag-amber-ink" : "text-ink-body"}`}>
          {currency.headline}
        </p>
      )}

      {superseded.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {superseded.map((plan) => (
            <li key={plan.planId} className="text-xs text-ink-body">
              {plan.sentence}
              {plan.supersededBy.some((item) => item.note) && (
                <ul className="mt-1 list-inside list-disc text-ink-muted">
                  {plan.supersededBy
                    .filter((item) => item.note)
                    .map((item) => (
                      <li key={`${plan.planId}-${item.label}`}>
                        {item.label}: {item.note}
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The undated plans are listed too, but quietly: "we cannot tell" is a
          prompt to fill in a date, not an alarm. */}
      {unknowable.length > 0 && currency.supersededCount > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {unknowable.length} other plan{unknowable.length === 1 ? "" : "s"} here{" "}
          {unknowable.length === 1 ? "has" : "have"} no issue date, so nothing can say either way
          about {unknowable.length === 1 ? "it" : "them"}.
        </p>
      )}

      {currency.undated.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {currency.undated.join(", ")} {currency.undated.length === 1 ? "says it" : "say they"}{" "}
          changed work already priced but {currency.undated.length === 1 ? "carries" : "carry"} no
          issue date, so {currency.undated.length === 1 ? "it" : "they"} cannot be placed against
          any sheet.{" "}
          <Link href="/bids" className="text-link hover:text-link-hover">
            Add the date on the bid
          </Link>
          .
        </p>
      )}
    </div>
  );
}
