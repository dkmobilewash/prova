import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { CapabilitiesSection } from "@/components/CapabilitiesSection";
import { PayApplicationPanel } from "@/components/landing/PayApplicationPanel";
import { CertifiedPayrollPanel } from "@/components/landing/CertifiedPayrollPanel";
import { ApprenticeRatioPanel } from "@/components/landing/ApprenticeRatioPanel";
import { JobCostPanel } from "@/components/landing/JobCostPanel";
import { FactTicker } from "@/components/landing/FactTicker";

/**
 * The visitor-facing content of the public landing page (app/page.tsx).
 * Pulled into its own component, out of app/page.tsx, because Next.js's
 * page-file type checking rejects any named export from a page module
 * besides the handful it recognises (metadata, generateMetadata, ...) —
 * "LandingPage is not a valid Page export field" is a BUILD failure, not
 * a typecheck one, so it only shows up in `next build`.
 *
 * Static on purpose: no database read, no auth() call, so it renders fast
 * and is testable with a plain render — see app/page.test.ts, which
 * proves that directly by rendering this with no Clerk mock and no
 * request scope.
 *
 * EVERY CLAIM BELOW IS CHECKED AGAINST THE CODE, the same discipline
 * /pilot's header comment holds itself to (see apps/web/app/pilot/page.tsx)
 * and for the same reason: this audience runs certified payroll and
 * trust-fund remittances every month and will know instantly if a claim is
 * invented. If a feature is removed, remove its line here in the same
 * commit. No fabricated logos, testimonials or customer counts — there are
 * no customers yet, and a page that pretends otherwise loses this reader
 * faster than a plain one.
 *
 * ── THE LENGTH PASS (fourth round) ──────────────────────────────────────
 *
 * The founder said the page "still looks really empty" and wanted it "more
 * full and more completed", and he was right in a way that is measurable
 * rather than a matter of taste. MEASURED IN A REAL BROWSER AT 1440x900,
 * before this pass: 3391px, 3.77 screens, 353 words. Comparable pages
 * researched for the same buyer run 9-11 screens. The page was not badly
 * spaced; there was not enough on it.
 *
 * So this pass adds CONTENT, not whitespace. The five capabilities that
 * actually cost a union specialty-trade sub money each get a full section
 * — a heading, a paragraph in trade language, three concrete specifics,
 * and (for four of the five) a rendered panel of the real document,
 * alternating left and right so five sections do not read as one column.
 * The single most visible symptom, the hero's empty right half at desktop,
 * is now the pay application. Section 7 is the one without a panel; the
 * note on EVIDENCE below says why, and what it does instead.
 *
 * THE PANELS ARE NOT SCREENSHOTS AND ARE NEVER CALLED ONE. They live in
 * components/landing/ — the product's own column headers, row labels and
 * status strings, re-rendered as markup, with illustrative figures. This
 * file only places them; it does not own them.
 *
 * ONE THING ESTABLISHED WHILE WIRING THEM UP, recorded here because it is
 * the kind of claim a marketing page invents by accident: the brief for
 * this pass asked for a job-cost panel showing "estimated vs actual labor
 * HOURS on a takeoff line", AND THE APP DOES NOT DO THAT.
 * `JobLineItem.laborHours` is an estimate, and `lib/wip.ts` compares
 * estimated against actual in DOLLARS per line (Contract / Budget /
 * Current est. / Actual / % complete / Earned) — actual hours surface only
 * as the unpriced-hours coverage caveat on `jobWip.laborHourCoverage`.
 * The only thing in the codebase labelled "variance" is catalog UNIT COST
 * (lib/catalog-actuals.ts). So the job-cost section below claims dollars,
 * not hours. Do not "fix" that copy back.
 *
 * ── SECTION ORDER, which is the argument ────────────────────────────────
 *
 * Ranked by what costs this buyer money, which is not the order a feature
 * list would fall into:
 *
 *   1. Hero (+ pay application summary in the right half)
 *      — then the FACT TICKER, hugging the hero's foot: a continuously
 *        moving band of short verified statements about how the product
 *        is built (components/landing/FactTicker.tsx owns the list and
 *        every receipt). Not a section, not in the ranked list, not in a
 *        <Reveal>; see the note where it is placed.
 *   2. The old way, and the C Stream way   ← MOVED UP from fourth
 *   3. Getting paid
 *   4. Certified payroll
 *   5. Apprentice ratios
 *   6. Whether the job is making money
 *   7. Protecting yourself
 *   8. Everything else it does (the rail/tabs)
 *   9. Not generic construction software
 *  10. C Stream is new                     ← MOVED DOWN from second
 *  11. Closing CTA
 *
 * Two of those moves are deliberate and should not be quietly undone:
 *
 * - THE CONTRAST SECTION MOVED TO SECOND. It is the problem in the
 *   reader's own words, and it names WH-347, AIA forms, retainage, RFIs
 *   and submittals — the vocabulary that signals we know the business. It
 *   earns the rest of the page, so it goes before the rest of the page.
 *
 * - "C STREAM IS NEW" MOVED DOWN TO TENTH, immediately before the ask. It
 *   was second, on the theory that it was our proof. It is not proof; it
 *   is a DISCLOSURE. Second position put the weakest card in front of a
 *   reader who had not yet been given a reason to care, and it reads as an
 *   apology there. Directly before the ask, the identical words read as
 *   integrity. Every word of its substance is kept.
 *
 * ── CRAFT SPECS CARRIED FORWARD UNCHANGED ───────────────────────────────
 *
 * All measured live and still correct: headline clamp to ~96px desktop /
 * 48px phone; line-height 1.03; tracking -0.02em; one vertical rhythm
 * between every section; easing and duration as CSS custom properties in
 * globals.css (never an ad-hoc curve here); motion only on opacity and
 * transform; prefers-reduced-motion honoured at BOTH the JS and CSS layers
 * (Reveal.tsx and globals.css, independently); every piece of text visible
 * at rest; no horizontal overflow at 375px; the CTA at nav, hero and
 * close; existing tokens only; no new dependencies. The hero is never
 * wrapped in <Reveal> — nothing above the fold should fade in on load.
 */

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-8 py-4 text-lg font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";
const ctaQuiet =
  "inline-flex items-center justify-center rounded-md bg-neutral-800 px-8 py-4 text-lg font-medium text-ink transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-neutral-700";
const ctaNav =
  "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";

/** The one rhythm every section below uses, scaled down at phone width
 * rather than each section picking its own gap. See the file header. */
const sectionSpace = "mt-16 sm:mt-24 lg:mt-[120px]";

/** Named because this is the strongest thing the page has to say, not
 * generic "construction" copy. Matches the five trades CLAUDE.md names
 * this product for. */
const TRADES = ["Framing & drywall", "Plaster", "EIFS", "Ceilings", "Fireproofing"];

/**
 * The documents the product actually produces, by the names the trade uses
 * for them. Sits in the hero's left column under the buttons — see the
 * geometry note at the hero for why that column needed real content.
 *
 * This is the single fastest test a contractor can run on a page like
 * this: does it cover MY paperwork. So the list is nouns a sub already
 * has a folder for, not capabilities — and every one is checked against
 * the code, with the receipt beside it. If the product stops producing
 * one, remove its line in the same commit. Deliberately no counts, no
 * percentages and no comparisons; the page-wide invented-statistic guard
 * in app/page.test.ts runs over this block, because it is prose and not a
 * `data-landing-panel`.
 *
 * Two candidates were considered and left OUT because the app does not
 * produce them as documents: lien notices (lib/lien-deadlines.ts — the
 * app tracks deadlines a person ENTERED and never computes or drafts a
 * notice) and an OSHA 300 log (the safety module issues case numbers and
 * marks recordability, components/safetyLabels.ts, but renders no 300/300A
 * form).
 */
const PAPERWORK: { name: string; detail: string }[] = [
  {
    // lib/pay-application.ts calculatePayAppLineItem / calculatePayAppSummary;
    // app/(app)/jobs/[id]/pay-applications/[invoiceId]/page.tsx
    name: "Pay applications",
    detail: "G702/G703-style, off the schedule of values",
  },
  {
    // lib/wh347.ts buildWh347; app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx
    name: "Certified payroll",
    detail: "WH-347, from hours the crew already logged",
  },
  {
    // lib/fringe-remittance.ts RemittanceLocalRow; app/(app)/union-compliance/
    // remittance/page.tsx — "the monthly fringe remittance", one row per local
    name: "Fringe remittance",
    detail: "One sheet per local, for the month",
  },
  {
    // components/ChangeOrders.tsx; ChangeOrderCounter (jobs.prisma);
    // components/changeOrderStates.ts CONTRACT_EFFECT — SUBMITTED moves nothing
    name: "Change orders",
    detail: "Numbered; the sum moves only on approval",
  },
  {
    // RfiCounter (operations.prisma); components/rfiLabels.ts isOverdue,
    // derived on every render from an ENTERED dueBy
    name: "RFIs",
    detail: "Numbered, dated; overdue is never stored",
  },
  {
    // SubmittalCounter, SubmittalRevision (operations.prisma) — "sent
    // revisions are correspondence and are never deleted or renumbered"
    name: "Submittals",
    detail: "Every revision kept, none renumbered",
  },
  {
    // DailyFieldReport (operations.prisma) — crew read from that day's
    // TimeEntry rows by craft, weatherAuto fetched for the site
    // (lib/field-reports-core.ts), never typed
    name: "Daily field reports",
    detail: "Crew from the day's hours, weather fetched",
  },
  {
    // TmTicket (operations.prisma) — snapshot frozen at signing,
    // signaturePath drawn on the phone; apps/mobile/app/ticket/[jobId].tsx;
    // app/api/v1/jobs/[id]/tickets/route.ts
    name: "T&M tickets",
    detail: "Signed on site, frozen at signing",
  },
];

/**
 * The problem/contrast section — the "single most defensible section"
 * available, because a GC-first platform cannot honestly run this
 * argument against its own buyer. Every right-column line is a
 * restatement of a capability the sections below it draw, so it carries
 * the same receipt rather than a new, unbacked one; the left column
 * describes how the job gets done WITHOUT this app, in general terms —
 * deliberately no invented statistics (no "X minutes saved", no "X% of
 * subs") standing in for research nobody has actually run here.
 */
const OLD_WAY = [
  "The estimate lives in one file, the contract in another, and the job cost gets rebuilt from scratch",
  "Certified payroll is assembled by hand from timesheets, one WH-347 at a time",
  "A pay application means retyping the schedule of values into the GC's own AIA forms",
  "Retainage is tracked in a spreadsheet somebody has to remember to update",
  "RFIs and submittals live in an email thread until somebody loses track of one",
];

const NEW_WAY = [
  "One estimate becomes the contract, the budget and the job cost — entered once", // Job/JobLineItem — ARCHITECTURE.md
  "Certified payroll generates from the hours your crew already logged", // lib/certified-payroll.ts, lib/wh347.ts
  "AIA-style pay applications build straight from your schedule of values", // lib/pay-application.ts
  "Retainage withheld and released per job, calculated from the job itself", // lib/retainage.ts
  "RFIs and submittals are numbered, dated and never reissued", // /rfis, /submittals counters
];

/**
 * Section 7's three cards. This is the one ranked section with no rendered
 * panel beside it, and that is a scoping decision rather than an oversight:
 * the panel set in components/landing/ is four documents (pay application,
 * WH-347, apprentice ratio, job cost) and an RFI/submittal register is not
 * one of them. Three cards carry the weight instead of a thin two-column
 * row with an empty right half — which is the exact defect this whole pass
 * exists to remove from the hero.
 *
 * Receipts, in order: RfiCounter / SubmittalCounter / ChangeOrderCounter
 * (CLAUDE.md's counter roll-call — they only ever increment);
 * components/rfiLabels.ts `isOverdue`/`daysBetween` and
 * components/submittalLabels.ts `submittalState`, both DERIVED on every
 * render and never stored; DailyFieldReport, JobMedia photos, punch lists
 * and the apps/mobile offline outbox.
 */
const EVIDENCE = [
  {
    title: "Numbered, never reissued",
    body: "RFIs, submittals and change orders take their number from a counter that only counts up. Delete a row and the number does not come back around — which is the whole point on a document a GC has already been sent.",
  },
  {
    title: "Nothing stored that can go stale",
    body: "Overdue, days open and which revision is current are worked out from the dates every time they are shown. A stored flag can disagree with the thing it was derived from, and that disagreement is how somebody builds from a superseded drawing.",
  },
  {
    title: "Kept as it happened",
    body: "Daily field reports, site photos and punch lists, dated and attributable, entered from the deck of the building on a phone with no signal — queued and sent when there is signal again.",
  },
];

/**
 * One of the ranked capability sections. A heading, a
 * paragraph in trade language, three concrete specifics, and the rendered
 * panel of the document the section is about.
 *
 * `flip` alternates which side the panel lands on at desktop, so five
 * sections in a row do not read as one column. It only ever changes the
 * ORDER of two grid children, never their content — at phone the panel is
 * always last, under the words, because a panel is evidence for a claim
 * and the claim should arrive first on a small screen.
 *
 * `lg:` rather than `sm:` for the two-column split deliberately: these
 * panels carry real tables, and a 384px tablet column makes a G703
 * continuation sheet unreadable for no gain.
 */
function CapabilitySection({
  heading,
  lead,
  points,
  panel,
  panelId,
  flip = false,
}: {
  heading: string;
  lead: string;
  points: string[];
  panel: React.ReactNode;
  /** This placement's handle, counted by app/page.test.ts. */
  panelId: string;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={`min-w-0 ${flip ? "lg:order-2" : ""}`}>
        <h2 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl">{heading}</h2>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-body sm:text-lg">{lead}</p>
        <ul className="mt-6 flex flex-col gap-3">
          {points.map((point) => (
            <li key={point} className="flex gap-3 text-sm leading-relaxed text-ink-body sm:text-base">
              <span aria-hidden className="mt-0.5 shrink-0 text-brand">
                &#8212;
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div data-landing-panel={panelId} className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>
        {panel}
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      {/* ---------------------------------------------------------- header
          The first of three CTA placements (nav, hero, closing section). */}
      <header className="flex items-center justify-between gap-4">
        <Image
          src="/brand/cstream-wordmark.png"
          alt="C Stream"
          width={240}
          height={48}
          className="h-8 w-auto sm:h-10"
          priority
        />
        <Link href="/sign-up" className={ctaNav}>
          Sign up
        </Link>
      </header>

      {/* -------------------------------------------------------------- 1
          Hero. Deliberately outside <Reveal>: the first screen should be
          there immediately, at full size, not fade in.

          The right half used to be empty at desktop — the single most
          visible thing wrong with this page. It now holds the pay
          application summary, which is both the thing this buyer most
          wants and the fastest possible proof that this is not generic
          construction software. */}
      {/* THE HEADLINE SPANS THE FULL WIDTH AND THE SPLIT HAPPENS BELOW IT,
          and that is a measured decision rather than a stylistic one.

          The obvious way to fill the empty right half is a two-column hero
          with the headline in the left column. Tried, measured, rejected:
          at 1440 the container is 1088px inside its padding, so a 420px
          panel column leaves the headline about 612px — and
          "subcontractors." alone is wider than that at 96px. It wrapped to
          six ragged lines and pushed past its own column. The only ways to
          make it fit were to shrink the headline (the 96px is a spec this
          page was tuned to) or to shrink the panel past the point a G703
          is legible.

          So the headline keeps the full 1088px and its three lines, and
          the subhead, chips, CTAs and panel share the row underneath. The
          right half is full either way, which was the actual problem. */}
      <section className="flex min-h-[78svh] flex-col justify-center gap-8 py-10 sm:gap-10">
        {/* THE FLOOR WAS 3rem AND IT MADE THE WHOLE PAGE WIDER THAN A
            320px PHONE. Measured in real Chromium 2026-09-21, which is the
            only thing that can see it — happy-dom does no layout:

              device 320 -> window.innerWidth 342   (the page pans sideways)
              device 360 -> window.innerWidth 360
              device 375 -> window.innerWidth 375

            Isolated by hiding this element and watching 342 become 320,
            not inferred. The cause is "subcontractors." — one unbreakable
            word, 326px wide at 48px, in a 288px content box. A word that
            cannot fit sets the page's MINIMUM CONTENT WIDTH, the browser
            widens the layout viewport to hold it, and then
            `scrollWidth === innerWidth` is true the whole time: the check
            everybody writes for this passes while the page is 22px wider
            than the phone. 320 CSS px is iPhone SE 1st gen and 5/5s, and —
            the bigger audience — any iPhone with Display Zoom on.

            2.5rem is the largest floor that fits: at 40px the word needs
            288px in 288px. 2.75rem still needs 300. Nothing at or above
            444px changes, because 9vw passes 40px there and the clamp has
            not been on its floor since — the measured desktop scale the
            comment below defends is untouched, and 96px at the top end
            still is. `e2e/specs/public-layout.public.spec.ts` asserts the
            layout viewport equals the device at 320 and 375, so this
            cannot come back unnoticed. */}
        {/* The clamp's upper end, the 1.03 leading and the -0.02em tracking
            are MEASURED specs carried forward from the scale pass and are
            not to be traded away for layout convenience. A `lg:` override
            was tried here and silently dropped the desktop headline from
            96px to 72px; the layout is sized to the type instead. */}
        <h1 className="max-w-4xl text-[clamp(2.5rem,9vw,6rem)] font-semibold leading-[1.03] tracking-[-0.02em] text-ink">
          The job-site system for union specialty-trade subcontractors.
        </h1>
        {/* `items-start`, NOT `items-center`. The pay-application panel is
            ~578px tall. When the left column was ~242px (subhead, chips,
            buttons), centring the row split the difference and left a
            207px hole between the headline and the subhead — read as "the
            page looks empty" twice before anyone measured it. Top-aligning
            put the subhead directly under the headline, where it belongs,
            and moved the surplus to the BOTTOM: ~336px of bare background
            under the Sign in button, beside the lower half of the panel,
            which is where the founder pointed the third time.

            The fix for that is content, not alignment. The column now
            carries the paperwork list (PAPERWORK above) under the buttons,
            and the subhead and chips step up one size at `lg` where the
            96px headline had left them undersized. Measured at 1440x900
            after this change: the left column and the panel are within a
            few tens of pixels of each other — see the changelog entry for
            the numbers. Do not put `items-center` back, and do not close
            the gap with padding: the column has to be the height it is
            because of what is in it. */}
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-14">
          <div className="flex min-w-0 flex-col gap-8">
            <p className="max-w-2xl text-lg leading-relaxed text-ink-body sm:text-xl lg:text-2xl">
              The estimate, the contract, the crew&rsquo;s hours, certified payroll and the GC&rsquo;s
              pay application &mdash; all in one place, so the same numbers don&rsquo;t get typed in
              three times.
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Trades C Stream is built for">
              {TRADES.map((trade) => (
                <li
                  key={trade}
                  className="rounded-full border border-line-card bg-surface px-4 py-1.5 text-sm font-medium text-ink-label lg:text-base"
                >
                  {trade}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link href="/sign-up" className={cta}>
                Sign up
              </Link>
              <Link href="/sign-in" className={ctaQuiet}>
                Sign in
              </Link>
            </div>
            {/* The paperwork list. Two columns at EVERY width, including
                375px, on purpose: at phone width this sits between the
                buttons and the panel, and eight single-column rows would
                push the panel most of a screen further down. Two columns of
                short names keep it to four rows there. `data-landing-paperwork`
                is this file's handle for app/page.test.ts, which asserts the
                block is inside the hero and that the statistic guard sees it. */}
            <div data-landing-paperwork className="border-t border-line-card pt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                The paperwork it produces
              </h2>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                {PAPERWORK.map((doc) => (
                  <li key={doc.name} className="min-w-0">
                    <p className="text-sm font-semibold text-ink-label lg:text-base">{doc.name}</p>
                    <p className="mt-0.5 text-xs leading-snug text-ink-body lg:text-sm">{doc.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {/* `data-landing-panel` is this file's own handle on a placement,
              deliberately NOT an attribute reached for inside
              components/landing/ — those components belong to another lane,
              and a guard that asserts on markup it does not own breaks on
              somebody else's refactor without saying anything useful. See
              app/page.test.ts, which counts these. */}
          <div data-landing-panel="pay-application" className="min-w-0">
            <PayApplicationPanel />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ the ticker
          A continuously moving band of short, verified statements about
          how the product is built — components/landing/FactTicker.tsx
          owns the list and the receipts. Placed HERE, hugging the bottom
          of the hero rather than between two sections lower down, for two
          reasons. The hero is the screen the founder called empty, twice,
          and it is the only screen most visitors see; motion here is
          motion where it is looked at. And it is the one place on the page
          where a band of many short facts is not competing with a section
          that is itself making an argument — the contrast block below
          opens the case, and the ticker is a preview of the evidence, not
          part of the case.

          Deliberately NOT inside <Reveal>: it is its own motion, and
          page.test.ts derives the reveal count from the section list, so
          wrapping it would either break that count or need a literal. It
          is also not a `data-landing-panel`: it is prose, so the page-wide
          invented-statistic guard runs over it, which is wanted. */}
      <div className="mt-2 sm:mt-4">
        <FactTicker />
      </div>

      {/* -------------------------------------------------------------- 2
          The problem, in the reader's own language. Moved up from fourth:
          it earns the rest of the page, so it goes before the rest. */}
      <Reveal className={sectionSpace}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">The old way, and the C Stream way</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 sm:gap-8">
          <div className="rounded-xl border border-line-card bg-surface p-6 sm:p-8">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">The old way</h3>
            <ul className="mt-4 flex flex-col gap-4">
              {OLD_WAY.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed text-ink-body sm:text-base">
                  <span aria-hidden className="mt-0.5 shrink-0 text-bar-rose">
                    &#10005;
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line-card bg-surface p-6 sm:p-8">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">The C Stream way</h3>
            <ul className="mt-4 flex flex-col gap-4">
              {NEW_WAY.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed text-ink-body sm:text-base">
                  <span aria-hidden className="mt-0.5 shrink-0 text-bar-green">
                    &#10003;
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>

      {/* -------------------------------------------------------------- 3
          Getting paid. First of the five ranked sections, because it is
          the biggest single pain a sub has — a competitor built an entire
          company on this one capability alone. */}
      <Reveal className={sectionSpace}>
        <CapabilitySection
          heading="Getting paid"
          lead="The pay application is the document that decides whether you make payroll this month, and on most jobs it is built by retyping your own schedule of values into the GC's forms. Here it builds itself out of the job."
          points={[
            // lib/pay-application.ts — calculatePayAppLineItem / calculatePayAppSummary
            "A G702/G703-style summary and continuation sheet, off the schedule of values already on the job",
            // lib/retainage.ts — held and released per job
            "Retainage held and released per job, calculated from the job rather than remembered in a spreadsheet",
            // payAppEntryError — refuses the over-billing case with a specific message
            "It refuses to bill a line past its scheduled value, and says what to do instead — an approved change order, or stored materials now installed",
          ]}
          panel={<PayApplicationPanel />}
          panelId="pay-application"
        />
      </Reveal>

      {/* -------------------------------------------------------------- 4
          Certified payroll. Weekly grind plus legal exposure, and on
          union work it gates the payment above. */}
      <Reveal className={sectionSpace}>
        <CapabilitySection
          flip
          heading="Certified payroll, from hours already logged"
          lead="Every week, for every worker, on every prevailing-wage job — name, classification, hours by day, rate, fringe. It is assembled from timesheets by hand almost everywhere, and a wrong one is not a clerical problem."
          points={[
            // lib/wh347.ts — buildWh347, WH347_DAY_COUNT = 7, S/O/DT/SD rows
            "A real WH-347 sheet: seven dated day columns, straight time and overtime on their own rows",
            // FringeRateSchedule: baseWage + pension + vacation + healthWelfare + training
            "Fringe rates by craft and effective date — pension, vacation, health & welfare, training",
            // Wh347BlockingField / WH347_BLOCKING_FIELD_REASON, form.fileable
            "If something is missing it tells you it is not ready to file, and names the field — rather than printing a form that is wrong",
          ]}
          panel={<CertifiedPayrollPanel />}
          panelId="certified-payroll"
        />
      </Reveal>

      {/* -------------------------------------------------------------- 5
          Apprentice ratios. The most differentiated capability for THIS
          buyer specifically; no general construction tool does it. */}
      <Reveal className={sectionSpace}>
        <CapabilitySection
          heading="Apprentice ratios, on the day you go over"
          lead="The ratio is enforced per day, so a compliant month does not undo a Tuesday you ran two apprentices to one journeyman. Most systems can only show you an average, which is the one shape of number that hides it."
          points={[
            // lib/apprentice-ratio.ts — reviewRatioByDay, per job × union local × day
            "Per job, per local, per day, measured in hours — off the hours the crew already logged",
            // ApprenticeRatioRule: apprenticeCount / journeymenCount, per local
            "Your local's own rule (1 per 3, 1 per 5) recorded per local, with where it is written down",
            // DayRatioStatus INCOMPLETE — unclassified hours are never counted as journeyman
            "Hours with no craft tag are reported as can't-be-judged, never quietly counted as journeyman",
          ]}
          panel={<ApprenticeRatioPanel />}
          panelId="apprentice-ratio"
        />
      </Reveal>

      {/* -------------------------------------------------------------- 6
          Whether the job is making money. */}
      <Reveal className={sectionSpace}>
        <CapabilitySection
          flip
          heading="Whether the job is actually making money"
          lead="Most subs find out a job went wrong when it is finished. Because the estimate, the hours and the costs are the same object here, the answer is available while there is still something you can do about it."
          points={[
            // lib/wip.ts — calculateLineItemWip / calculateJobWip
            "Budget, current estimate, actual and earned revenue per line item — not one number for the whole job",
            // lib/labor-job-cost.ts — burdened labour from logged hours
            "Labour costed at burdened rates from the hours logged against the line, base wage plus fringes",
            // jobWip.laborHourCoverage — the amber caveat, drawn in the panel
            "When some hours are unpriced it says so on the figure, instead of quietly reporting a number it cannot stand behind",
          ]}
          panel={<JobCostPanel />}
          panelId="job-cost"
        />
      </Reveal>

      {/* -------------------------------------------------------------- 7
          Protecting yourself. The evidence trail when there is a dispute. */}
      <Reveal className={sectionSpace}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">
          Protecting yourself when it goes wrong
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg">
          Every job that ends in an argument ends in an argument about what was asked, when it was
          asked, and who answered. That record is worth more than anything else on this page &mdash;
          and it is only worth anything if it was kept as it happened, rather than reconstructed
          afterwards by the side with the most to lose.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-6">
          {EVIDENCE.map((item) => (
            <div key={item.title} className="rounded-xl border border-line-card bg-surface p-6">
              <h3 className="text-lg font-semibold text-ink-label">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-body">{item.body}</p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* -------------------------------------------------------------- 8
          Everything else. The rail/tabs component, kept but repurposed —
          the five above have full sections now, so repeating them here
          would have been the same words twice. See
          CapabilitiesSection.tsx's own header. */}
      <Reveal className={sectionSpace}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">Everything else it does</h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg">
          The rest of the job, in the same system, so none of it needs a second spreadsheet.
        </p>
        <div className="mt-8">
          <CapabilitiesSection />
        </div>
      </Reveal>

      {/* -------------------------------------------------------------- 9
          Objection handling. Copy unchanged. */}
      <Reveal className={`${sectionSpace} max-w-2xl`}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">Not generic construction software</h2>
        <p className="mt-4 text-base leading-relaxed text-ink-body sm:text-lg">
          The classifications, the fringe rate schedules and the compliance paperwork are built around
          union framing and drywall, plaster, EIFS, ceiling and fireproofing work &mdash; not bolted on
          after the fact for a general contractor&rsquo;s app that happened to add a trade field.
        </p>
      </Reveal>

      {/* ------------------------------------------------------------- 10
          "C Stream is new" — moved down from second to here, immediately
          before the ask. It is a disclosure, not proof. See the header. */}
      <Reveal className={sectionSpace}>
        <div className="rounded-2xl border border-line-card bg-surface p-8 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">C Stream is new</h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg">
            This is not an established platform with years of customers behind it &mdash; it is a new
            system, built directly with subs in these trades. You will find rough edges, and what you
            run into gets fixed fast rather than filed away.
          </p>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg">
            {/* Deliberately worded around the marketing vocabulary this
                page is guarded against ("testimonial", "trusted by",
                "hundreds of"). page.test.ts matches those words BLUNTLY,
                with no notion of polarity — and a sentence denying them
                would trip it. The fix is not to teach the guard about
                negation, which is how a simple check becomes an
                unmaintainable one and then gets deleted; it is for the
                page not to contain the words at all, which is a stronger
                property and the one actually wanted here. */}
            That is also why this page shows no customer logos, no count of how many subs are using
            it, and no quoted endorsements. There is nothing here we could not show you in the
            product itself.
          </p>
        </div>
      </Reveal>

      {/* ------------------------------------------------------------- 11
          Closing CTA. The third of three placements (nav, hero, here). */}
      <Reveal className={sectionSpace}>
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line-card bg-surface p-8 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">See it on your own job</h2>
          <p className="max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg">
            Put a real job in it &mdash; the estimate, a week of hours, one pay application &mdash; and
            see whether the numbers come out where you expect.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link href="/sign-up" className={cta}>
              Sign up
            </Link>
            <Link href="/sign-in" className={ctaQuiet}>
              Sign in
            </Link>
          </div>
        </div>
      </Reveal>

      {/* ----------------------------------------------------------- footer */}
      <footer className={`${sectionSpace} border-t border-line-card pt-8 text-xs text-ink-muted`}>
        <Link href="/privacy" className="text-link hover:text-link-hover">
          Privacy
        </Link>{" "}
        &middot;{" "}
        <Link href="/terms" className="text-link hover:text-link-hover">
          Terms
        </Link>
      </footer>
    </main>
  );
}
