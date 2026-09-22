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
 * western US, which is exactly C Stream's buyer. It makes ONE argument — the
 * week's hours, entered once, feed the WH-347, the fringe remittance and the
 * apprentice ratio — then offers to load a member's data and states the
 * founding offer.
 *
 * Kept out of app/associations/wwcca/page.tsx for the reason LandingPage.tsx
 * is kept out of app/page.tsx: a page module may export only what Next
 * recognises, and this needs to be rendered by a plain test.
 *
 * EVERYTHING THAT NAMES THE ASSOCIATION IS IN ./wwcca.ts, with the rule for
 * what may and may not be said about it and the list of what the association
 * must approve. The short version: NO ENDORSEMENT EXISTS, so nothing here may
 * read as one.
 *
 * ── SHORT, AND THE PANELS DO THE EXPLAINING (remodel, 2026-09-21) ─────────
 *
 * Cyrus's direction: far fewer words without saying less. The first version
 * ran to ~1,150 visible words outside the panels; this one is a headline and
 * one line per idea. The four panels (components/landing/, the product's real
 * functions over illustrative figures, each captioned "Figures are
 * illustrative" by PanelFrame) carry the detail the paragraphs used to.
 *
 * ── EVERY CLAIM IS TRUE AS WRITTEN, AND NONE IMPLIES A MISSING FEATURE ────
 *
 * The first version listed what the product does not do yet. That section is
 * gone — this is a marketing page — and the rule that replaces it is stricter,
 * not looser: each claim below carries its receipt in the comment beside it,
 * and nothing may say or imply what the code does not do. Concretely, and
 * enforced in page.test.ts:
 *
 *   - The WH-347's page 2 (the Statement of Compliance) is not built, and
 *     lib/wh347.ts marks every form not fileable. So the page says C Stream
 *     BUILDS the WH-347 from the week's hours — never "file", "file-ready" or
 *     "submit" your certified payroll.
 *   - Overtime is ENTERED as a pay type, not calculated. No claim here says
 *     otherwise.
 *   - The remittance report computes the month per local, classification,
 *     member and fund; it does not hold fund account numbers or addresses. So
 *     it is described as what it computes, never as ready to mail.
 *   - The pay application is not built from hours; it comes off the same
 *     job's schedule of values, and is described that way.
 *
 * This page is shown to the association's Innovation Committee, and the
 * association's CEO is related to a founder. A claim they catch as false
 * costs far more than a claim left out. If a feature changes, change its line
 * here in the same commit.
 *
 * WIDTH: through `PageShell width="working"`, as pageWidthCensus requires of
 * any new route.
 */

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-6 py-3 text-base font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500 sm:px-8 sm:py-4 sm:text-lg";
const ctaQuiet =
  "inline-flex items-center justify-center rounded-md bg-neutral-800 px-6 py-3 text-base font-medium text-ink transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-neutral-700 sm:px-8 sm:py-4 sm:text-lg";
const ctaNav =
  "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";

/** The landing page's section rhythm, so the two pages read as one site. */
const sectionSpace = "mt-16 sm:mt-24 lg:mt-28";

/** The trades a WWCCA member runs, in the words they use — the same five
 * CLAUDE.md names this product for, in wall-and-ceiling vocabulary. A label,
 * not a feature claim. */
const TRADES = ["Metal framing & drywall", "Lath & plaster", "EIFS", "Acoustical ceilings", "Fireproofing"];

/**
 * What one entry of hours produces. In the hero's left column, beside the
 * WH-347 panel, because it IS the headline's claim — and because the column
 * needs real content to stand as tall as the panel (see the hero note).
 *
 * The pay application is deliberately NOT in this list: it is not built from
 * hours. It has its own row further down, described as what it is.
 */
const FROM_THE_HOURS: { name: string; detail: string }[] = [
  {
    // lib/wh347.ts buildWh347 — groups the week's TimeEntry rows by worker and
    // day, rate with its fringe beside it; app/(app)/jobs/[id]/certified-payroll/wh-347
    name: "WH-347",
    detail: "Every worker, every day, rate and fringe",
  },
  {
    // lib/fringe-remittance.ts buildRemittanceReport — local -> classification
    // -> member; pension, vacation, health & welfare, training each broken out
    name: "Fringe remittance",
    detail: "Per local, per member, each fund broken out",
  },
  {
    // lib/apprentice-ratio.ts reviewRatioByDay — per job × local × day, in hours
    name: "Apprentice ratio",
    detail: "Checked per local, every day worked",
  },
];

/** One panel beside the one line it is evidence for. `flip` alternates the
 * side at desktop only; on a phone the panel always follows the words. */
function PanelRow({
  heading,
  line,
  panel,
  flip = false,
}: {
  heading: string;
  line: string;
  panel: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={`min-w-0 ${flip ? "lg:order-2" : ""}`}>
        <h3 className="text-2xl font-semibold leading-tight text-ink sm:text-3xl">{heading}</h3>
        <p className="mt-4 text-base leading-relaxed text-ink-body sm:text-lg">{line}</p>
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
          on 2026-09-21. Under `lg` the grid is one column, so the headline
          has the full content width there. */}
      <section className="py-12 sm:py-16 lg:py-20">
        {/* THE LOGO SLOT. Renders nothing at all while WWCCA.logoSrc is null
            — no wrapper, no gap — and it is null until the association gives
            written permission. See THE LOGO in ./wwcca.ts. */}
        {WWCCA.logoSrc && (
          <div data-association-logo className="mb-6 flex items-center gap-3">
            <Image src="/brand/cstream-wordmark.png" alt="C Stream" width={160} height={32} className="h-6 w-auto" />
            <span aria-hidden className="text-ink-muted">
              &times;
            </span>
            <Image src={WWCCA.logoSrc} alt={WWCCA.logoAlt} width={160} height={48} className="h-8 w-auto" />
          </div>
        )}
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">{WWCCA.eyebrow}</p>
        {/* TWO COLUMNS AT `lg`, because one column left the right half of a
            desktop screen bare: a left-aligned headline, a paragraph and two
            buttons, then ~700px of background beside them — the landing
            page's hole before #404, and the founder's most repeated
            complaint about this product.

            The right half is the headline made visible: the week's hours
            already laid out as a WH-347 by `buildWh347`. Certified payroll
            rather than the pay application the landing page leads with,
            because this headline is about HOURS and the pay application is
            not built from them. It appears once on the page.

            `items-start`, NOT `items-center`, for the landing page's reason
            (see the note at its hero grid): centring a short column against a
            tall panel splits the surplus into a hole ABOVE the copy — 207px
            of it between headline and subhead, the first time. Top-aligned,
            the words sit where the eye starts. The surplus that top-aligning
            moves BELOW the buttons is closed with content, not padding: the
            trades and FROM_THE_HOURS are what make the left column about as
            tall as the panel. (Measured at 1500px with only headline,
            paragraph and buttons: a 407px column beside a 726px panel. The
            line, chips and list step up one size at `lg`, where the 72px
            headline had left them undersized — the landing page's move.)

            Under `lg` it is one column and the panel follows the words, so on
            a phone the headline, the line and Sign up come first. */}
        <div className="mt-4 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:gap-14">
          <div className="flex min-w-0 flex-col gap-8">
            <h1 className="text-[clamp(2.25rem,7vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
              The week&rsquo;s hours, entered once.
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-ink-body sm:text-xl lg:text-2xl">
              {/* Receipts: FROM_THE_HOURS, one per document. */}
              Log the crew&rsquo;s hours once. The WH-347, the fringe remittance and the apprentice
              ratio are all built from them.
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Trades">
              {TRADES.map((trade) => (
                <li
                  key={trade}
                  className="rounded-full border border-line-card bg-surface px-4 py-1.5 text-sm font-medium text-ink-label lg:text-base"
                >
                  {trade}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <Link href="/sign-up" className={cta}>
                Sign up
              </Link>
              <a href="#founding" className={ctaQuiet}>
                The founding-member offer
              </a>
            </div>
            <div className="border-t border-line-card pt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                From one entry of hours
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-3">
                {FROM_THE_HOURS.map((doc) => (
                  <li key={doc.name} className="min-w-0">
                    <p className="text-base font-semibold text-ink-label lg:text-lg">{doc.name}</p>
                    <p className="mt-1 text-sm leading-snug text-ink-body lg:text-base">{doc.detail}</p>
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

      {/* ------------------------------------------------------ the panels
          One heading and one line each; the panel is the explanation. */}
      <section className="border-t border-line-card pt-12 sm:pt-16">
        <div className="flex flex-col gap-16 sm:gap-24">
          <PanelRow
            heading="Apprentice ratios, day by day"
            // ApprenticeRatioRule: apprenticeCount / journeymenCount per union
            // local, with programStandardReference (where the rule is written
            // down); lib/apprentice-ratio.ts reviewRatioByDay — per job × local × day
            line="Record each local's ratio from its JATC standards. Every day's hours are checked against it, so a bad Tuesday shows as Tuesday."
            panel={<ApprenticeRatioPanel />}
          />
          <PanelRow
            flip
            heading="The pay application, off the same job"
            // lib/pay-application-query.ts scheduledValueFor — quantity × unitPrice
            // of the job's own JobLineItem; lib/retainage.ts — held and released per job
            line="The lines you estimated are the lines you bill, with retainage held and released per job."
            panel={<PayApplicationPanel />}
          />
          <PanelRow
            heading="The same hours, costed"
            // lib/labor-job-cost.ts — base wage plus fringe, from the hours logged
            // to each line; lib/wip.ts calculateLineItemWip
            line="Labor at wage plus fringe, against the line it was logged to, while the job is still running."
            panel={<JobCostPanel />}
          />
        </div>
      </section>

      {/* ------------------------------------------------ we load your data
          A service promise from the founders, not a product feature, so it
          claims no import format. A schedule of values is NOT an import kind
          (lib/spreadsheet-import.ts ImportKind), which is why the offer is
          that we enter it. */}
      <section className={sectionSpace}>
        <div className="rounded-2xl border border-line-card bg-surface p-6 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">We load your data for you</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-body sm:text-lg">
            Send us your crew list, open jobs and schedules of values, in whatever spreadsheet they
            live in now. We put them in, and you start on your own jobs.
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

          <ol className="mt-8 grid gap-4 sm:grid-cols-2">
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

      {/* ------------------------------------------------ disclosure + footer
          Two short lines. "C Stream is new" is the disclosure kept from the
          first version, cut to its substance; the independence line is
          WWCCA.independence. */}
      <footer className={`${sectionSpace} border-t border-line-card pt-8 text-sm leading-relaxed text-ink-body`}>
        <p>C Stream is new, built by two people with subs in these trades.</p>
        <p className="mt-2">{WWCCA.independence}</p>
        <p className="mt-6 text-xs text-ink-muted">
          <Link href="/privacy" className="text-link hover:text-link-hover">
            Privacy
          </Link>{" "}
          &middot;{" "}
          <Link href="/terms" className="text-link hover:text-link-hover">
            Terms
          </Link>
        </p>
      </footer>
    </PageShell>
  );
}
