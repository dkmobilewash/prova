/**
 * A continuously moving band of short, true statements about how C Stream
 * is built, for the public landing page (components/LandingPage.tsx). The
 * founder asked for "a spinning wheel of ... fun facts about why the
 * software is good, just to make it look more high tech and fuller", after
 * calling the page empty twice. This is that: motion and density, and the
 * motion is the point — it is the one thing on the page that is alive
 * without being scrolled.
 *
 * EVERY LINE BELOW IS A STATEMENT ABOUT WHAT THE CODE DOES TODAY, verified
 * by reading it, and the file that proves it is named beside it. This is
 * precisely the place marketing fiction creeps in — "fun facts about why
 * the software is good" is an invitation to invent — so the rules are
 * stricter than the rest of the page's, and FactTicker.test.ts enforces
 * the mechanical half of them:
 *
 *   - no performance claim ("faster", "saves"), no percentage, no
 *     comparison to anyone;
 *   - no customer, user, job or dollar count;
 *   - nothing aspirational — what it does, never what it will do;
 *   - NO NUMERAL AT ALL. app/page.test.ts already runs an invented-
 *     statistic pattern over this ticker (it is prose, not a panel, so it
 *     is not stripped). This list holds itself to the stronger rule
 *     because a fact that needs a digit is on its way to being a
 *     statistic, and nothing here needs one ("seven day columns" reads
 *     fine). A fact that seems to need a number belongs in a panel, where
 *     the number is computed by the product's own arithmetic.
 *
 * If a capability is removed, remove its line here in the same commit.
 *
 * MARQUEE, NOT CAROUSEL. A carousel that auto-advances moves content the
 * reader is meant to read; a ticker is ambient, each item is glanceable,
 * and nothing is lost by missing one. The list is rendered twice and the
 * track translates by exactly half its own width, so the loop is seamless;
 * the second copy is `aria-hidden` so a screen reader gets the list once.
 *
 * SAFE AT REST, LIKE Reveal.tsx. The default styling — no media query at
 * all — is a wrapped, fully readable, static list with the clone hidden.
 * Only inside `@media (prefers-reduced-motion: no-preference)` does it
 * become a single moving row (globals.css, in the same block that gates
 * the reveal motion). So a reader who asked for less motion gets every
 * fact, in full, with nothing clipped off-screen; and a browser that never
 * applies the animation at all still shows a complete list. Animates
 * `transform` only, no JS, no dependency. Hover or keyboard focus pauses it
 * so anyone who wants to read one can.
 *
 * Tokens only: `surface`, `line-card`, `ink-body`, `ink-muted`, `brand` as
 * text. No new colour.
 */

export interface TickerFact {
  text: string;
  /** Where this was verified, by file. Not rendered. */
  source: string;
}

export const FACTS: readonly TickerFact[] = [
  {
    text: "RFI, submittal and change order numbers only count up — a deleted one is never reissued",
    source: "lib/actions/rfis.ts issueRfiNumber; lib/actions/submittals.ts; lib/actions/changeOrders.ts; lib/counterCensus.test.ts",
  },
  {
    text: "Certified payroll is built from the hours your crew already logged, not typed in again",
    source: "lib/certified-payroll.ts buildCertifiedPayrollSummary; lib/wh347.ts buildWh347",
  },
  {
    text: "Apprentice ratios are judged day by day, never averaged over the month",
    source: "lib/apprentice-ratio.ts reviewRatioByDay",
  },
  {
    text: "A WH-347 with something missing says it is not ready to file, and names the field",
    source: "lib/wh347.ts Wh347BlockingField, WH347_BLOCKING_FIELD_REASON, Wh347Form.fileable",
  },
  {
    text: "A pay app line cannot be billed past its scheduled value — it tells you what to do instead",
    source: "lib/pay-application.ts payAppEntryError",
  },
  {
    text: "Overdue is worked out from the dates every time it is shown, never stored",
    source: "components/rfiLabels.ts isOverdue; packages/db/prisma/schema/operations.prisma (Rfi)",
  },
  {
    text: "A sent RFI can be closed but never deleted — the GC holds a copy too",
    // Named by file and behaviour rather than by function, on purpose: the
    // destructive-form census (rowActionsCensus.test.ts) tokenises code and
    // treats a removal action's NAME as a call to it, so the identifier of
    // the RFI delete action must not appear in this file's code.
    source: "lib/actions/rfis.ts — the RFI delete action refuses anything past DRAFT; setRfiClosed",
  },
  {
    text: "Money is kept to the exact cent, never as rounded floating point",
    source: "packages/db/prisma/schema/*.prisma — every money column is Decimal(12,2) or an integer of cents; no Float carries money",
  },
  {
    text: "Hours logged on the phone with no signal wait in an outbox and send when there is signal",
    source: "apps/mobile/lib/outbox.ts; apps/mobile/lib/sync-queue.ts",
  },
  {
    text: "Once the foreman signs the day, its hours are locked until the office reopens it",
    source: "lib/actions/labor.ts liveSignoff; lib/actions/timesheetSignoff.ts; lib/timesheet-signoff.ts",
  },
  {
    text: "Calling a punch item fixed and verifying it fixed are two different permissions",
    source: "lib/actions/punchLists.ts capabilityForStatus; lib/permissions.ts VERIFY_PUNCH_ITEMS",
  },
  {
    text: "Site photos keep when they were taken and who took them, apart from when they were uploaded",
    source: "packages/db/prisma/schema/media.prisma JobMedia.capturedAt, capturedByUserId, createdAt",
  },
  {
    text: "The assistant can propose a change, but only you can confirm it — and the browser cannot alter what runs",
    source: "components/AskProposalCard.tsx; lib/actions/ask.ts confirmAskProposal",
  },
  {
    text: "Retainage already withheld on a pay app is never rewritten when the rate changes",
    // The column's identifier is deliberately not written here: the
    // retainage single-source census (lib/retainage-single-source.test.ts)
    // enumerates every file that names it, and this file does not read it.
    source: "lib/retainage.ts calculateRetainageSummary (sums the retainage snapshotted onto each Invoice at creation)",
  },
];

/**
 * One copy of the list. The moving geometry lives in globals.css, and the
 * one number that must agree between there and here is the ITEM GAP: in
 * motion each list carries a trailing padding equal to its own item gap
 * (`--landing-ticker-gap`), so two copies laid end to end read as one
 * continuous row and a translate of exactly half the track lands every
 * item where its twin started. Padding on the track itself would break
 * that — half the track would then include half the padding — which is why
 * the card's own inset is on the <section>, not here.
 */
function FactList({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul
      aria-hidden={hidden ? true : undefined}
      className={`landing-ticker__list ${hidden ? "landing-ticker__clone" : ""}`}
    >
      {FACTS.map((fact) => (
        <li key={fact.text} className="flex items-center gap-3 text-sm text-ink-body sm:text-base">
          <span aria-hidden className="shrink-0 text-brand">
            &#9670;
          </span>
          <span>{fact.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function FactTicker() {
  return (
    <section
      data-landing-ticker
      aria-label="How C Stream is built"
      /* Focusable so a keyboard user can PAUSE it (focus-within in the CSS)
         — the same affordance hover gives a mouse. A focus ring in the
         brand yellow says where focus went; the region is otherwise inert. */
      tabIndex={0}
      className="landing-ticker rounded-xl border border-line-card bg-surface px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:px-6"
    >
      <div className="landing-ticker__viewport">
        <div className="landing-ticker__track">
          <FactList />
          <FactList hidden />
        </div>
      </div>
    </section>
  );
}
