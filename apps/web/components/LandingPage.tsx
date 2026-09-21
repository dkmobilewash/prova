import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { CapabilitiesSection } from "@/components/CapabilitiesSection";

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
 * SCALE, MOTION AND STRUCTURE PASS (second and third rounds, same
 * content). The founder's follow-up on #404 asked for scale, restraint,
 * and the six capabilities on a scroll wheel. A second and third message
 * supplied measured numbers from comparable product pages (Linear, Gusto,
 * Siteline, Rippling) that replaced the earlier guesses:
 *
 * - Headline: fluid `clamp(3rem, 9vw, 6rem)` — 48px on a phone (Gusto's
 *   own phone floor, the closest buyer analogue: a non-technical SMB
 *   owner), ~96px at desktop, tightened leading and slightly negative
 *   tracking so bigger reads as designed rather than just large.
 * - One vertical rhythm between every section (not an ad-hoc set of
 *   values): `mt-16 sm:mt-24 lg:mt-[120px]`, landing on Rippling's
 *   measured 120px at desktop.
 * - Section order matches what every comparable page does: hero, then
 *   proof (our honest "C Stream is new" — moved up from the footer,
 *   which is where it originally sat), then a problem/contrast section,
 *   then the six capabilities, then objection handling, then a closing
 *   CTA, then the footer.
 * - Motion: two shared easing tokens in globals.css
 *   (--ease-landing / --ease-landing-snap), not an ad-hoc curve per
 *   component. Only opacity and transform ever animate. The hero is never
 *   wrapped in <Reveal>: nothing above the fold should fade in on load,
 *   which reads as lag rather than polish.
 * - The six capabilities: a horizontal snap rail below `sm` (confirmed
 *   against Linear's own phone layout), a tab switcher at `sm` and up
 *   (confirmed against Linear, Gusto and Siteline, none of which run a
 *   rail on desktop) — see components/CapabilitiesSection.tsx.
 *
 * Still true from the first pass and unchanged by any of this: no
 * gradient-mesh hero, no 3D, no particle field, no tilted device mockups,
 * existing dark/gold tokens only.
 *
 * REAL PRODUCT SCREENSHOTS WERE ASKED FOR, TWICE, AND ARE DELIBERATELY NOT
 * HERE. Producing them needs a seeded database
 * (packages/db/scripts/seed-demo.mjs) and a signed-in session to reach the
 * authenticated pages worth showing (a job's tabs, WH-347 certified
 * payroll, the Money Rail, a pay application) — this environment has
 * neither a local Postgres (no docker/postgres/brew on PATH) nor, on
 * purpose, this repo's own real Neon/Clerk credentials, which CLAUDE.md
 * and this session's own standing rule say not to hand to an agent
 * worktree. Rather than fake it with an illustration, that section is
 * simply absent. See the PR description for the exact recipe to add it
 * later: flat, full-bleed, no browser chrome, no tilt — confirmed as the
 * right treatment against Siteline, Raken and Knowify, the three
 * comparable pages that show real product at all.
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
 * The problem/contrast section — the "single most defensible section"
 * available, because a GC-first platform cannot honestly run this
 * argument against its own buyer. Every right-column line is a
 * restatement of a capability from CapabilitiesSection.tsx, so it carries
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
  "Certified payroll generates from the hours your crew already logged", // lib/certified-payroll.ts
  "AIA-style pay applications build straight from your schedule of values", // lib/pay-application.ts
  "Retainage withheld and released per job, calculated from the job itself", // lib/retainage.ts
  "RFIs and submittals are numbered, dated and never reissued", // /rfis, /submittals counters
];

export function LandingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
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

      {/* -------------------------------------------------------------- hero
          Deliberately outside <Reveal>: the first screen should be there
          immediately, at full size, not fade in. */}
      <section className="flex min-h-[78svh] flex-col justify-center gap-8 py-10 sm:gap-10">
        <h1 className="max-w-4xl text-[clamp(3rem,9vw,6rem)] font-semibold leading-[1.03] tracking-[-0.02em] text-ink">
          The job-site system for union specialty-trade subcontractors.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-body sm:text-xl">
          The estimate, the contract, the crew&rsquo;s hours, certified payroll and the GC&rsquo;s pay
          application &mdash; all in one place, so the same numbers don&rsquo;t get typed in three
          times.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Trades C Stream is built for">
          {TRADES.map((trade) => (
            <li
              key={trade}
              className="rounded-full border border-line-card bg-surface px-4 py-1.5 text-sm font-medium text-ink-label"
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
      </section>

      {/* ------------------------------------------------------- proof
          "C Stream is new" moved here, right after the hero — it is our
          proof (there is nothing else to show yet), and per every
          comparable page researched, proof belongs in the first two
          sections, not the footer. */}
      <Reveal className={sectionSpace}>
        <div className="rounded-2xl border border-line-card bg-surface p-8 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">C Stream is new</h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg">
            This is not an established platform with years of customers behind it &mdash; it is a new
            system, built directly with subs in these trades. You will find rough edges, and what you
            run into gets fixed fast rather than filed away.
          </p>
        </div>
      </Reveal>

      {/* ------------------------------------------------- problem/contrast */}
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

      {/* ------------------------------------------------------ capabilities */}
      <Reveal className={sectionSpace}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">What it does</h2>
        <div className="mt-8">
          <CapabilitiesSection />
        </div>
      </Reveal>

      {/* --------------------------------------------- objection handling */}
      <Reveal className={`${sectionSpace} max-w-2xl`}>
        <h2 className="text-3xl font-semibold text-ink sm:text-4xl">Not generic construction software</h2>
        <p className="mt-4 text-base leading-relaxed text-ink-body sm:text-lg">
          The classifications, the fringe rate schedules and the compliance paperwork are built around
          union framing and drywall, plaster, EIFS, ceiling and fireproofing work &mdash; not bolted on
          after the fact for a general contractor&rsquo;s app that happened to add a trade field.
        </p>
      </Reveal>

      {/* -------------------------------------------------------- closing CTA
          The third of three CTA placements (nav, hero, here). */}
      <Reveal className={sectionSpace}>
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line-card bg-surface p-8 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink sm:text-3xl">See it on your own job</h2>
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
