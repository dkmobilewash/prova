import {
  lookupStanding,
  registerLookup,
  registryEntries,
  telHref,
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
 *
 * ── THE TWO LINKS, AND WHY ONE OF THEM GOES TO A SEARCH BOX ──
 *
 * The card used to say the licence was a lookup key and then give nobody a way
 * to use one. Both links here close that, and both are deliberately modest:
 *
 *   - the CSLB link goes to a SEARCH PAGE, with the number shown beside it to
 *     paste. CSLB's detail URL looks deep-linkable and is not — requested cold
 *     it 302s to that same search page, measured in a real browser. The
 *     reasoning and the measurement are in `lib/sales-registry.ts`;
 *   - the `tel:` link appears only when a number is actually on file. It is a
 *     link a PERSON taps. There is no line-type field in this data and no
 *     dialler anywhere near it.
 *
 * `SalesLead.phone` is written ONLY by the hand-typed new/edit lead form
 * (`lib/actions/sales.ts`); `importSubListing` never sets it, because a §4104
 * listing has no telephone column to read. So on an imported lead the `tel:`
 * link is absent by construction, which is exactly the state the CSLB link
 * exists for.
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
  const lookup = registerLookup(lead);
  /* The href is stripped to digits; the text is what somebody typed, because
     that is what reads back correctly to a human. */
  const href = telHref(lead);
  const call = href && lead.phone ? { href, display: lead.phone.trim() } : null;

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

      {/* The way to act on the sentence above. `tel:` only when a number is
          really on file; the CSLB search whenever there is a licence to paste
          into it — including on a callable lead, where it is how somebody
          confirms the company is the one they think. */}
      {(call || lookup) && (
        <div className="mb-4 flex flex-col gap-3">
          {call && (
            <p className="text-sm text-ink-body">
              <a
                href={call.href}
                className="font-mono tabular-nums text-link underline hover:text-link-hover"
              >
                {call.display}
              </a>
            </p>
          )}
          {lookup && (
            <div>
              <a
                href={lookup.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-link underline hover:text-link-hover"
              >
                {lookup.linkLabel}
              </a>
              <p className="mt-1 text-xs text-ink-muted">{lookup.instruction}</p>
            </div>
          )}
        </div>
      )}

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
