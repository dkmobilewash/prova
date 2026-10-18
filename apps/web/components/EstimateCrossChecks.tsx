import type { CrossCheck } from "@/lib/estimating/estimate-crosschecks";

/**
 * "Alpha Drywall for Metal stud framing is not on the estimate."
 *
 * ── WHY THIS IS A PLAIN LIST AND NOT A BOX THAT DEMANDS ANYTHING ──
 *
 * These are the first checks in the app that cross one quantity against
 * another, and what they report is a QUESTION with two ordinary answers.
 * Somebody who traced a wall to get a number and deliberately left it off the
 * bid has not made a mistake; somebody who carried a quote and put the cost on
 * a line they renamed has not either. So this names what it sees and stops.
 *
 * AMBER, NOT ROSE, and the distinction is the one `bid-margin.ts` draws: a bid
 * under its own cost is a FACT and gets rose. A measurement that is not on the
 * estimate is a thing to look at. `MissingIndirects` is muted for the same
 * reason and sits directly beside this; rose here would make the two read as
 * different severities of the same kind of finding, which they are not.
 *
 * NO BUTTON. `MissingIndirects` offers one press because adding a general
 * condition is a single unambiguous write. Neither of these is: posting a
 * measurement needs a recipe, a height and which sides are boarded, and
 * putting a carried quote on the estimate is a decision the `/bids` page
 * already owns a press for. A button here would be a second, worse copy of
 * both — so this links nowhere and tells the estimator what to go and look at.
 *
 * Renders NOTHING when there is nothing, rather than an empty panel saying all
 * is well: this file cannot see what is missing that it has no rule for, so a
 * reassurance would be a claim about work it never examined.
 */
export function EstimateCrossChecks({ checks }: { checks: CrossCheck[] }) {
  if (checks.length === 0) return null;

  return (
    <section role="alert" className="mt-3 rounded-md border border-tag-amber bg-tag-amber p-3">
      <h4 className="text-sm font-semibold text-tag-amber-ink">Worth a look before this goes out</h4>
      <ul className="mt-1 flex flex-col gap-1">
        {checks.map((check) => (
          <li key={check.kind} className="text-xs text-tag-amber-ink">
            {check.sentence}
          </li>
        ))}
      </ul>
    </section>
  );
}
