/**
 * The six capabilities, presented two different ways depending on viewport
 * — same content, same underlying data, the LAYOUT switches. Confirmed
 * against comparable product pages rather than picked by eye: Linear,
 * Gusto and Siteline all run a horizontal snap-scroll rail on phone and
 * none of them run one at desktop, where a tab/carousel switcher is what
 * every one of them uses instead.
 *
 * - Below `sm` (phone, where Cyrus judges this): a horizontal snap-scroll
 *   rail. Native CSS scroll-snap, no JS runs the scrolling — reachable by
 *   touch, trackpad or keyboard with JS disabled entirely. Cards are
 *   85vw so the next one visibly peeks in (measured off Linear's own
 *   phone layout: 328px cards in a 390px viewport, ~84vw) — that peek is
 *   the entire affordance, no arrows, no dot indicators.
 * - `sm` and up: a tab switcher — one capability's headline and body
 *   shown at a time, the other five as labels beside it, numbered to
 *   match the numbered-control look comparable pages use (Gusto's "01 02
 *   03").
 *
 * The desktop switcher is native `<details>`/`<summary>`, not a JS
 * cross-fade. Giving every `<details>` the same `name` makes the browser
 * treat them as a mutually-exclusive group — only one open at a time,
 * like radio buttons — a real, broadly-supported HTML feature (Chrome
 * 120+, Safari 17.2+, Firefox 125+), not a hack. Chosen over a JS
 * cross-fade deliberately: every panel stays in the DOM and fully
 * readable with no motion involved in switching AT ALL, so there is
 * nothing for prefers-reduced-motion to need to disable — the requirement
 * a cross-fade would have to work to satisfy, this satisfies by
 * construction. `display: contents` on each `<details>` (see
 * .landing-tabs in globals.css) removes only the wrapper from the grid's
 * box model, so every `<summary>` lines up in the label column and the one
 * open panel's content lands in the content column beside it.
 *
 * The rail's own scroll container is components/CapabilitiesRail.tsx, a
 * small client component — see its header for why (arrow-key operation
 * needed a real key handler; touch and trackpad already worked from plain
 * CSS).
 */

import { CapabilitiesRail } from "@/components/CapabilitiesRail";

/**
 * WHAT THIS LIST IS NOW, AND WHY IT CHANGED.
 *
 * It used to be the page's PRIMARY presentation of six capabilities — the
 * whole of "what it does". The rebuild that made the page roughly twice as
 * long gave the five that cost a sub the most money a full section each,
 * with a rendered panel of the real document (getting paid, certified
 * payroll, apprentice ratios, job cost, the evidence trail). A rail that
 * repeated those five would have been the same words twice.
 *
 * So this is the SECONDARY summary — the things that did not earn a
 * section of their own but are real and worth knowing exist. The component
 * below is unchanged: same phone rail, same desktop tabs, same
 * `<details name>` group. Only the data moved, and everything in
 * CapabilitiesSection.test.ts derives its counts from
 * `CAPABILITIES.length`, so it followed without an edit.
 *
 * Same receipt rule as the rest of the page: a comment naming the file or
 * route that actually does it, and no claim beyond what that code does.
 * The lien-deadlines line is the one to read before adding another — that
 * page says in its own copy that it does NOT work the dates out for you,
 * and this list says the same, because a page that oversells one line is
 * not trusted on the other seven.
 */
export const CAPABILITIES: { title: string; body: string }[] = [
  {
    // lib/fringe-remittance.ts, FringeRateSchedule (pension/vacation/
    // healthWelfare/training rates) on /union-compliance
    title: "Fringe remittance to the funds",
    body: "Pension, vacation, health & welfare and training, worked out from the same logged hours the certified payroll comes from.",
  },
  {
    // components/ChangeOrders.tsx, ChangeOrderCounter (jobs.prisma)
    title: "Change orders that move the contract",
    body: "Numbered from a counter that only counts up, and the line they raise moves with them — so the schedule of values stays the contract.",
  },
  {
    // lib/phase-code-rollup.ts, /phase-codes
    title: "Your own cost codes, across every job",
    body: "Phase codes you define, with budget against actual rolled up across all the jobs carrying them — not one job at a time.",
  },
  {
    // /cash-flow — AR aging, retainage receivable, monthly projection
    title: "Cash flow and what is still owed",
    body: "What each GC owes and how long it has been owed, retainage receivable, and a month-by-month projection built only from dates already on file.",
  },
  {
    // /lien-deadlines — dates ENTERED from the statute or an attorney
    title: "Lien deadlines, kept in front of you",
    body: "Preliminary notices, liens, stop payment notices and bond claims. You enter the dates — it sorts them and warns you 14 days out.",
  },
  {
    // /backcharges + BackchargeCounter (backcharges.prisma)
    title: "Backcharges, on the record",
    body: "What another trade or the GC is charging you for, numbered and dated, so it is answered rather than discovered in a final accounting.",
  },
  {
    // /safety + SafetyCaseCounter (operations.prisma) — OSHA case numbers
    title: "Safety incidents and OSHA case numbers",
    body: "Case numbers issued from a counter that never reissues a retired one, because a retired OSHA case number coming back is its own problem.",
  },
  {
    // apps/mobile — offline outbox and cached reads (#382, #398, #399, #403)
    title: "A phone that works with no signal",
    body: "Hours, photos, field reports, materials and punch lists from the deck of a building with no bars — queued and sent when there is signal again.",
  },
];

function ordinal(i: number) {
  return String(i + 1).padStart(2, "0");
}

export function CapabilitiesSection() {
  return (
    <>
      {/* ------------------------------------------------------- phone rail */}
      <div className="sm:hidden">
        <div className="relative">
          <CapabilitiesRail
            label={`What else C Stream does — ${CAPABILITIES.length} capabilities. Swipe, scroll, or use the arrow keys.`}
          >
            {CAPABILITIES.map((item, i) => (
              <article
                key={item.title}
                data-rail-card
                className="w-[85vw] shrink-0 snap-start rounded-xl border border-line-card bg-surface p-6"
              >
                <span aria-hidden className="text-sm font-semibold text-ink-muted">
                  {ordinal(i)}
                </span>
                <h3 className="mt-1 text-lg font-semibold text-ink-label">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-body">{item.body}</p>
              </article>
            ))}
          </CapabilitiesRail>
          {/* Visual affordance that there is more to the right — a plain
              edge fade, not a decoration. Purely presentational: hidden
              from the accessibility tree, since the region's own
              aria-label already says there are six. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-canvas to-transparent"
          />
        </div>
        <p className="mt-3 text-xs text-ink-muted">Swipe or scroll for the rest &rarr;</p>
      </div>

      {/* ---------------------------------------------------- desktop tabs */}
      <div className="landing-tabs hidden sm:grid sm:grid-cols-[260px_1fr] sm:gap-10">
        {CAPABILITIES.map((item, i) => (
          <details key={item.title} name="capability" open={i === 0} className="contents">
            <summary>
              <span aria-hidden className="mr-3 font-mono text-sm text-ink-muted">
                {ordinal(i)}
              </span>
              {item.title}
            </summary>
            <div>
              <h3 className="text-2xl font-semibold text-ink-label">{item.title}</h3>
              <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-body">{item.body}</p>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
