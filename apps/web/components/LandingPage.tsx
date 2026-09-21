import Image from "next/image";
import Link from "next/link";

/**
 * The visitor-facing content of the public landing page (app/page.tsx).
 * Pulled into its own component, out of app/page.tsx, because Next.js's
 * page-file type checking rejects any named export from a page module
 * besides the handful it recognises (metadata, generateMetadata, ...) —
 * "LandingPage" is not a valid Page export field" is a BUILD failure, not
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
 */

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-6 py-3 text-base font-semibold text-neutral-900 hover:bg-yellow-500";
const ctaQuiet =
  "inline-flex items-center justify-center rounded-md bg-neutral-800 px-6 py-3 text-base font-medium text-ink hover:bg-neutral-700";

/** Named because this is the strongest thing the page has to say, not
 * generic "construction" copy. Matches the five trades CLAUDE.md names
 * this product for. */
const TRADES = ["Framing & drywall", "Plaster", "EIFS", "Ceilings", "Fireproofing"];

/** Each line is something the app does today, not a roadmap item. Keep the
 * receipt in the comment beside it — that is what makes the next edit
 * honest instead of aspirational. */
const CAPABILITIES: { title: string; body: string }[] = [
  {
    // Job/JobLineItem unified object — ARCHITECTURE.md
    title: "One estimate, no retyping",
    body: "Price the job once. The same line items become the contract, the budget and the job-costing structure.",
  },
  {
    // lib/certified-payroll.ts, lib/fringe-remittance.ts on /union-compliance
    title: "Certified payroll & fringe remittance",
    body: "Weekly WH-347-style certified payroll, and the pension, vacation, H&W and training remittance reports, from the hours your crew already logged.",
  },
  {
    // lib/apprentice-ratio.ts — per job, per local, per day
    title: "Apprentice ratios, tracked daily",
    body: "Apprentice-to-journeyman ratio per job, per local, per day, flagged the day you go over — not a monthly average that hides it.",
  },
  {
    // lib/pay-application.ts (G702/G703) + lib/retainage.ts
    title: "Pay applications & retainage",
    body: "AIA-style pay applications built from your schedule of values, with retainage withheld and released per job.",
  },
  {
    // /rfis, /submittals, /drawings — evidence records, counters never reissued
    title: "RFIs, submittals, drawings",
    body: "Numbered, dated and never reissued once sent — a paper trail a GC can't argue with.",
  },
  {
    // DailyFieldReport, JobMedia photos, punch lists, offline outbox (#382, #403)
    title: "The field, on record",
    body: "Daily reports, site photos and punch lists — dated and attributable, from a phone that still works with no signal on site.",
  },
];

export function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      {/* ---------------------------------------------------------- header */}
      <header>
        <Image
          src="/brand/cstream-wordmark.png"
          alt="C Stream"
          width={240}
          height={48}
          className="h-9 w-auto sm:h-10"
          priority
        />
      </header>

      {/* -------------------------------------------------------------- hero */}
      <section className="mt-10 flex flex-col gap-6 sm:mt-14">
        <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl md:text-5xl">
          The job-site system for union specialty-trade subcontractors.
        </h1>
        <p className="text-base leading-relaxed text-ink-body sm:text-lg">
          The estimate, the contract, the crew&rsquo;s hours, certified payroll and the GC&rsquo;s pay
          application &mdash; all in one place, so the same numbers don&rsquo;t get typed in three
          times.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Trades C Stream is built for">
          {TRADES.map((trade) => (
            <li
              key={trade}
              className="rounded-full border border-line-card bg-surface px-3 py-1 text-xs font-medium text-ink-label"
            >
              {trade}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/sign-up" className={cta}>
            Sign up
          </Link>
          <Link href="/sign-in" className={ctaQuiet}>
            Sign in
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------ capabilities */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">What it does</h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((item) => (
            <li key={item.title} className="rounded-lg border border-line-card bg-surface p-4">
              <h3 className="font-semibold text-ink-label">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-body">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------ specificity */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">Not generic construction software</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-body">
          The classifications, the fringe rate schedules and the compliance paperwork are built around
          union framing and drywall, plaster, EIFS, ceiling and fireproofing work &mdash; not bolted on
          after the fact for a general contractor&rsquo;s app that happened to add a trade field.
        </p>
      </section>

      {/* -------------------------------------------------------- new build */}
      <section className="mt-14 rounded-lg border border-line-card bg-surface p-5">
        <h2 className="text-xl font-semibold text-ink">C Stream is new</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-body">
          This is not an established platform with years of customers behind it &mdash; it is a new
          system, built directly with subs in these trades. You will find rough edges, and what you run
          into gets fixed fast rather than filed away.
        </p>
      </section>

      {/* ----------------------------------------------------------- footer */}
      <footer className="mt-14 flex flex-col items-start gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/sign-up" className={cta}>
            Sign up
          </Link>
          <Link href="/sign-in" className={ctaQuiet}>
            Sign in
          </Link>
        </div>
        <p className="border-t border-line-card pt-4 text-xs text-ink-muted">
          <Link href="/privacy" className="text-link hover:text-link-hover">
            Privacy
          </Link>{" "}
          &middot;{" "}
          <Link href="/terms" className="text-link hover:text-link-hover">
            Terms
          </Link>
        </p>
      </footer>
    </main>
  );
}
