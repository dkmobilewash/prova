import {
  lookupStanding,
  registryEntries,
  type LeadRegistry,
} from "@/lib/sales-registry";

/**
 * "On the public register" — the licence number, the registration, the city and
 * the document that introduced this lead.
 *
 * A server component with no interactivity: every decision it renders is made by
 * `lib/sales-registry.ts`, which is pure and tested. The split is not tidiness —
 * no test in this repo can see layout, so anything decided inside JSX is decided
 * where only a human eye can check it.
 *
 * ── WHY THE LICENCE IS THE LOUDEST THING ON THE CARD ──
 *
 * An imported lead has no telephone number, because a §4104 listing does not
 * carry one. The licence is the key that joins to California's public CSLB
 * licence file, which does — so on an imported lead this card is the difference
 * between a name in a CRM and a company somebody can ring. Rendering the number
 * under a bare "Licence" heading would be a fact nobody acts on; the standing
 * sentence above it says what the number is FOR.
 *
 * Nothing here has looked a number up, and no sentence claims otherwise.
 */

/** The standing is a word AND a colour, never a colour — CLAUDE.md's rule. */
const STANDING_STYLE = {
  CALLABLE: "bg-tag-green text-tag-green-ink",
  LOOKUP_READY: "bg-tag-amber text-tag-amber-ink",
  NO_KEY: "bg-tag-slate text-tag-slate-ink",
} as const;

const STANDING_LABEL = {
  CALLABLE: "Has a number",
  LOOKUP_READY: "Licence to look up",
  NO_KEY: "No way to reach them",
} as const;

export function SalesLeadRegistry({ lead }: { lead: LeadRegistry }) {
  const entries = registryEntries(lead);
  const standing = lookupStanding(lead);

  return (
    <section className="mt-10">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">On the public register</h2>
        <span
          className={`rounded px-2 py-0.5 text-xs ${STANDING_STYLE[standing.kind]}`}
        >
          {STANDING_LABEL[standing.kind]}
        </span>
      </div>
      <p className="mb-4 text-sm text-ink-body">{standing.sentence}</p>

      {entries.length === 0 ? (
        /* A real empty state that says what would fill it, per the list-page
           rules. Most leads are typed in by hand and have none of these, so the
           card must not read as a broken feature. */
        <div className="rounded-lg border border-line-card bg-surface p-6">
          <p className="text-sm text-ink-body">
            Nothing on the register yet. A licence number and a city arrive with
            any lead read off a public subcontractor listing, or you can put the
            licence in by hand above.
          </p>
        </div>
      ) : (
        <dl className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {entries.map((entry) => (
            <div
              key={entry.label}
              className="flex flex-col gap-0.5 p-4 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <dt className="text-xs uppercase tracking-wide text-ink-muted sm:w-40 sm:shrink-0">
                {entry.label}
              </dt>
              <dd
                className={
                  entry.identifier
                    ? "font-mono text-sm tabular-nums text-ink"
                    : "text-sm text-ink-body"
                }
              >
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
