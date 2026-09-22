import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PayApplicationPanel } from "@/components/landing/PayApplicationPanel";
import { CertifiedPayrollPanel } from "@/components/landing/CertifiedPayrollPanel";
import { ApprenticeRatioPanel } from "@/components/landing/ApprenticeRatioPanel";
import { JobCostPanel } from "@/components/landing/JobCostPanel";
import { FOUNDING_OFFER, WWCCA } from "./wwcca";

/**
 * The content of /associations/wwcca — a page for members of the Western
 * Wall & Ceiling Contractors Association: union wall-and-ceiling subs in the
 * western US, which is exactly C Stream's buyer. Shaped after Siteline's
 * per-association pages (`/trade-association/<slug>`), and deliberately
 * narrower than the public landing page: that page argues for the whole
 * product; this one argues for the ONE thing a union wall-and-ceiling sub on
 * public work feels every week — the same hours feeding certified payroll,
 * the trust-fund remittance and the apprentice ratio, with the pay
 * application built off the same job.
 *
 * Kept out of app/associations/wwcca/page.tsx for the reason LandingPage.tsx
 * is kept out of app/page.tsx: a page module may export only what Next
 * recognises, and this needs to be rendered by a plain test.
 *
 * EVERYTHING THAT NAMES THE ASSOCIATION IS IN ./wwcca.ts, with the rule for
 * what may and may not be said about it. Read that header before changing a
 * sentence here that mentions the WWCCA. The short version: NO ENDORSEMENT
 * EXISTS, so nothing here may read as one.
 *
 * EVERY PRODUCT CLAIM CARRIES ITS RECEIPT in the comment beside it, the
 * discipline /pilot and the landing page already hold themselves to, and for
 * a sharper reason: this page is meant to be read by the association's
 * Innovation Committee. A missing claim costs nothing there; a false one
 * costs the relationship. If a feature changes, change its line here in the
 * same commit.
 *
 * THE LIMITS ARE ON THE PAGE, NOT HIDDEN. "What it does not do yet" names
 * the WH-347's missing page 2, overtime being entered rather than
 * calculated, and the remittance sheet's missing fund and member numbers.
 * This audience runs those documents every week and would find each gap in
 * the first ten minutes; saying so first is the only version of this page
 * that survives a real member trying it.
 *
 * The four panels are the landing page's own (components/landing/): the
 * product's real functions run over illustrative wall-and-ceiling figures —
 * metal stud framing, drywall hang and finish, acoustical ceilings,
 * shaftwall — each captioned "Figures are illustrative" by PanelFrame
 * itself. This file places them and owns none of them.
 *
 * WIDTH: through `PageShell width="working"`, as pageWidthCensus requires of
 * any new route. The landing page sets its own `max-w-6xl` inside a
 * component; this page does not repeat that.
 */

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-6 py-3 text-base font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500 sm:px-8 sm:py-4 sm:text-lg";
const ctaQuiet =
  "inline-flex items-center justify-center rounded-md bg-neutral-800 px-6 py-3 text-base font-medium text-ink transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-neutral-700 sm:px-8 sm:py-4 sm:text-lg";
const ctaNav =
  "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";

/** The landing page's section rhythm, so the two pages read as one site. */
const sectionSpace = "mt-16 sm:mt-24 lg:mt-28";

/**
 * Where one week of hours goes. The four documents a union wall-and-ceiling
 * sub on public work produces, each with what it is built from.
 *
 * THE PAY APPLICATION IS NOT BUILT FROM HOURS, and this list says so rather
 * than tidying it into "four documents from one timesheet". A G702/G703
 * bills against the schedule of values; hours do not enter it. What is true
 * — and is the claim made — is that the schedule of values is the SAME job's
 * line items the estimate was built on, so it is not retyped either.
 */
const OUTPUTS: { name: string; from: string; body: string }[] = [
  {
    // lib/wh347.ts buildWh347 — groups TimeEntry rows by day, WH347_DAY_COUNT = 7,
    // O row above S; app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx
    name: "Certified payroll (WH-347)",
    from: "From the hours",
    body: "Seven dated day columns per worker, straight time and overtime on their own rows, the rate printed with its fringe beside it.",
  },
  {
    // lib/fringe-remittance.ts — local -> classification -> member, four funds,
    // findEffectiveFringeRateSchedule per entry date; /union-compliance/remittance
    name: "Fringe remittance",
    from: "From the hours",
    body: "The month per local, per classification, per member — pension, vacation, health & welfare and training each broken out, at the rate in force on the day the hour was worked.",
  },
  {
    // lib/apprentice-ratio.ts reviewRatioByDay — per job × local × day, in hours
    name: "Apprentice ratio",
    from: "From the hours",
    body: "Checked per job, per local, per day — so the Tuesday you ran over shows up as Tuesday, not averaged away across the month.",
  },
  {
    // lib/pay-application-query.ts scheduledValueFor — quantity × unitPrice of the
    // job's own JobLineItem; ARCHITECTURE.md (one line, estimate through billing);
    // lib/pay-application.ts calculatePayAppSummary
    name: "Pay application (G702/G703)",
    from: "From the same job's schedule of values",
    body: "The lines you estimated are the lines you bill. Retainage is held and released per job.",
  },
];

/**
 * What the product does not do yet, stated on the page. Each is a real gap
 * in the code today, with the file that shows it. Remove a line only in the
 * commit that closes the gap.
 */
const NOT_YET: { title: string; body: string }[] = [
  {
    // lib/wh347.ts — "Page 2 ... is not built yet"; every form `fileable: false`
    title: "The WH-347 prints page 1 only",
    body: "The Statement of Compliance (page 2) is not built yet, so every week is marked not ready to file. You still sign page 2 the way you do today.",
  },
  {
    // TimeEntry.payType (STRAIGHT/OVERTIME/DOUBLE_TIME/SHIFT_DIFFERENTIAL) is entered;
    // lib/prevailing-wage.ts reports where entered pay types and recorded rules
    // disagree and never rewrites an entry — FEATURE-AUDIT.md
    title: "Overtime is entered, not calculated",
    body: "Hours are logged as straight time, overtime or double time. C Stream does not convert straight time to overtime for you; if you record your jurisdiction's overtime rules, it flags the weeks where the entered hours and those rules disagree.",
  },
  {
    // lib/fringe-remittance-filing.ts — fundEmployerNumber, fundRemitAddress,
    // memberIdNumber, duesCheckoff are printed in red as missing
    title: "The remittance sheet is not ready to mail as printed",
    body: "It does the arithmetic and names every member, but it holds no fund account numbers, fund addresses or member numbers, and no dues checkoff. It prints each of those as missing, in red, rather than leaving a blank that looks like a zero.",
  },
  {
    // lib/payroll-register-import.ts — reads the register a payroll system already
    // produces, for the WH-347's deduction and net-pay columns
    title: "It does not run payroll",
    body: "Keep your payroll service. C Stream reads the weekly payroll register it already produces, for the deductions and net pay on the WH-347.",
  },
];

/**
 * Beside the WH-347 panel in the hero. Moved up with the panel from the
 * panel section, receipts and all; change a line only with its feature.
 */
const HERO_PAYROLL_POINTS: string[] = [
  // lib/wh347.ts buildWh347 — groups the job's TimeEntry rows by worker and
  // day; the day columns and S/O rows are in OUTPUTS below, not repeated here
  "Built from the hours logged against the job that week, grouped by worker and day — not retyped from a timesheet",
  // FringeRateSchedule: baseWage + pension + vacation + healthWelfare + training, effectiveFrom
  "Fringe rates by craft and effective date — pension, vacation, health & welfare, training",
  // Wh347BlockingField / WH347_BLOCKING_FIELD_REASON
  "When a field is missing it names the field and marks the week not ready to file, instead of printing a form that is wrong",
];

/** One panel beside the words it is evidence for. `flip` alternates the side
 * at desktop only; on a phone the panel always follows the words. */
function PanelRow({
  heading,
  lead,
  points,
  panel,
  flip = false,
}: {
  heading: string;
  lead: string;
  points: string[];
  panel: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={`min-w-0 ${flip ? "lg:order-2" : ""}`}>
        <h3 className="text-2xl font-semibold leading-tight text-ink sm:text-3xl">{heading}</h3>
        <p className="mt-4 text-base leading-relaxed text-ink-body sm:text-lg">{lead}</p>
        <ul className="mt-5 flex flex-col gap-3">
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
      <div className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>{panel}</div>
    </div>
  );
}

export function WwccaLanding() {
  return (
    <PageShell width="working" className="pb-24">
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

      {/* ------------------------------------------------------------ hero
          Font floor 2.25rem at phone width, and every headline word is short.
          At 320px PageShell leaves 272px of content; a long word at a large
          clamp is what widened the landing page's layout viewport to 342px
          on 2026-09-21. The floor is unchanged by the two-column layout
          below: under `lg` the grid is one column and the headline has the
          full content width, exactly as before. */}
      <section className="py-12 sm:py-16 lg:py-20">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">{WWCCA.eyebrow}</p>
        {/* TWO COLUMNS AT `lg`, because one column left the right half of a
            desktop screen bare: a left-aligned headline, a paragraph and two
            buttons, then ~700px of background beside them. That is the
            founder's most repeated complaint about this product, and the
            landing page had the same hole until #404.

            The right half is the page's own claim made visible — the week's
            hours already turned into a WH-347 by `buildWh347`. Certified
            payroll rather than the pay application the landing page leads
            with, because this page's headline is about HOURS and the pay
            application is the one document on this page NOT built from them
            (see OUTPUTS). The panel is moved up from the panel section, not
            copied: it appears once on the page.

            `items-start`, NOT `items-center`, for the landing page's reason
            (see the note at its hero grid): centring a short column against
            a tall panel splits the surplus into a hole ABOVE the copy — 207px
            of it between headline and subhead, the first time. Top-aligned,
            the words sit where the eye starts and the panel's extra height
            falls below the buttons. Do not close any gap with padding.

            Under `lg` it is one column and the panel follows the buttons, so
            on a phone the headline, the paragraph and Sign up come first. */}
        <div className="mt-4 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:gap-14">
          <div className="min-w-0">
            <h1 className="text-[clamp(2.25rem,7vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
              The week&rsquo;s hours, entered once.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-relaxed text-ink-body sm:text-xl">
              {/* Receipts: OUTPUTS above, one per document. */}
              On a union public job, the same hours end up on the certified payroll, the trust-fund
              remittance and the apprentice-ratio check &mdash; and the pay application is built by hand
              from the schedule of values. In C Stream the hours are logged once and all three are built
              from them, and the pay application comes off the same job&rsquo;s schedule of values.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <Link href="/sign-up" className={cta}>
                Sign up
              </Link>
              <a href="#founding" className={ctaQuiet}>
                The founding-member offer
              </a>
            </div>
            {/* What the panel beside it shows, in words. The column needs
                real content to be as tall as the panel: with only the
                headline, paragraph and buttons it was ~407px against the
                panel's ~726px at 1500px wide, and the ~320px under the
                buttons was the landing page's third "looks empty" — the
                one it fixed with its paperwork list, not with padding.
                Two of these three lines sat beside this panel when it was
                lower down the page; receipts in HERO_PAYROLL_POINTS. */}
            <div className="mt-10 border-t border-line-card pt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                The certified payroll, from those hours
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {HERO_PAYROLL_POINTS.map((point) => (
                  <li key={point} className="flex gap-3 text-sm leading-relaxed text-ink-body sm:text-base">
                    <span aria-hidden className="mt-0.5 shrink-0 text-brand">
                      &#8212;
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="min-w-0">
            <CertifiedPayrollPanel />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ where the hours go */}
      <section className="border-t border-line-card pt-12 sm:pt-16">
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">One entry, four documents</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
          {/* apps/mobile/app/time; apps/mobile/app/handover.tsx (a crew member
              enters and signs their own hours on the foreman's phone);
              lib/sync-queue in apps/mobile — queued offline */}
          Hours are logged against the job, by craft and pay type &mdash; at the desk, or on a phone on
          the deck, where a crew member can put in and sign their own. Everything below reads those
          same entries.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {OUTPUTS.map((output) => (
            <li key={output.name} className="flex flex-col rounded-xl border border-line-card bg-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{output.from}</p>
              <h3 className="mt-2 text-lg font-semibold text-ink-label">{output.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-body">{output.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------ the panels */}
      <section className={sectionSpace}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">What it looks like on a wall-and-ceiling job</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
          Rendered by the product&rsquo;s own calculations, on a made-up tenant improvement: metal stud
          framing, drywall hang and finish, acoustical ceilings and shaftwall.
        </p>

        <div className="mt-12 flex flex-col gap-16 sm:gap-24">
          <PanelRow
            heading="Apprentice ratios, on the day you go over"
            lead="A compliant month does not undo a Tuesday you ran two apprentices to one journeyman. The check is daily, in hours, off the hours the crew logged."
            points={[
              // lib/apprentice-ratio.ts reviewRatioByDay
              "Per job, per local, per day",
              // ApprenticeRatioRule apprenticeCount / journeymenCount / programStandardReference
              "Your local's own rule, recorded per local with where it is written down",
              // DayRatioStatus INCOMPLETE
              "Hours with no craft tag are reported as can't-be-judged, never quietly counted as journeyman",
            ]}
            panel={<ApprenticeRatioPanel />}
          />
          <PanelRow
            flip
            heading="The pay application, off the schedule of values"
            lead="The schedule of values is the job's own line items, so the application is built from the job instead of retyped into the GC's forms."
            points={[
              // lib/pay-application.ts calculatePayAppLineItem / calculatePayAppSummary
              "G702/G703-style summary and continuation sheet",
              // lib/retainage.ts
              "Retainage held and released per job",
              // payAppEntryError in lib/pay-application.ts
              "It refuses to bill a line past its scheduled value, and says what to do instead",
            ]}
            panel={<PayApplicationPanel />}
          />
          <PanelRow
            heading="Whether the job is making money, while it is still running"
            lead="The same hours, costed at burdened rates against the line they were logged to."
            points={[
              // lib/wip.ts calculateLineItemWip / calculateJobWip
              "Budget, current estimate, actual and earned revenue per line item",
              // lib/labor-job-cost.ts
              "Labor at base wage plus fringes, from the hours logged against each line",
              // jobWip.laborHourCoverage
              "When some hours cannot be priced it says so on the figure",
            ]}
            panel={<JobCostPanel />}
          />
        </div>
      </section>

      {/* -------------------------------------------------- the honest limits */}
      <section className={sectionSpace}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">What it does not do yet</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
          You would find these in your first week, so here they are first.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {NOT_YET.map((item) => (
            <li key={item.title} className="rounded-xl border border-line-card bg-surface p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-ink-label">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-body">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------ we load your data
          The answer to the two objections subs actually raise: "we've always
          done it this way" and "moving our data is a nightmare". A service
          promise from the founders, not a product feature — so it claims no
          import format it does not have. What the importer takes is named
          exactly: lib/spreadsheet-import.ts ImportKind = clients | jobs |
          crew | costCodes; lib/quickbooks-import.ts; lib/jobber-import.ts.
          A schedule of values is NOT an import kind, which is why the offer
          is that we enter it. */}
      <section className={sectionSpace}>
        <div className="rounded-2xl border border-line-card bg-surface p-6 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">We load your data for you</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
            Nobody wants to spend a month typing their company into new software, and you should not
            have to. Send us what you already keep &mdash; the crew list, the open jobs, each
            job&rsquo;s schedule of values, in whatever spreadsheet or report they live in now &mdash;
            and we put it in. You start on your own jobs, not a blank screen.
          </p>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
            Nothing about the way you work has to change on day one. Keep your payroll service and your
            accounting system. If you would rather do it yourself, clients, jobs and crew import from a
            spreadsheet, and your client list can come across from QuickBooks Online or Jobber &mdash;
            shown to you before anything is saved.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- the founding offer
          All copy from FOUNDING_OFFER in ./wwcca.ts, the price included, and
          no counter: see that file's header. */}
      <section id="founding" className={`${sectionSpace} scroll-mt-8`}>
        <div className="rounded-2xl border border-brand/40 bg-surface p-6 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">{FOUNDING_OFFER.heading}</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">{FOUNDING_OFFER.lead}</p>
          {FOUNDING_OFFER.price && (
            <p className="mt-6 text-2xl font-semibold text-ink sm:text-3xl">{FOUNDING_OFFER.price}</p>
          )}
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">{FOUNDING_OFFER.onboarding}</p>
          <ul className="mt-6 flex flex-col gap-3">
            {FOUNDING_OFFER.terms.map((term) => (
              <li key={term} className="flex gap-3 text-base leading-relaxed text-ink-body">
                <span aria-hidden className="mt-0.5 shrink-0 text-brand">
                  &#10003;
                </span>
                <span>{term}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-body sm:text-base">{FOUNDING_OFFER.whyTen}</p>

          <h3 className="mt-10 text-lg font-semibold text-ink">How to ask</h3>
          <ol className="mt-4 flex flex-col gap-4">
            {FOUNDING_OFFER.howToAsk.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-neutral-900"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink-label">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-body">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <Link href="/sign-up" className={cta}>
              Sign up
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ disclosure + footer */}
      <section className={`${sectionSpace} max-w-3xl`}>
        <h2 className="text-xl font-semibold text-ink">C Stream is new</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-body sm:text-base">
          It is not an established platform with years of customers behind it. It is a new system,
          built with subs in these trades, and you will find rough edges. What you run into gets fixed
          fast rather than filed away.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-body sm:text-base">{WWCCA.independence}</p>
      </section>

      <footer className="mt-12 border-t border-line-card pt-8 text-xs text-ink-muted">
        <Link href="/privacy" className="text-link hover:text-link-hover">
          Privacy
        </Link>{" "}
        &middot;{" "}
        <Link href="/terms" className="text-link hover:text-link-hover">
          Terms
        </Link>
      </footer>
    </PageShell>
  );
}
