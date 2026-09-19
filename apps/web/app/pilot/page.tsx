import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

/**
 * The early-tester page — the ONE link handed to WWCCA members after a
 * demo, so a union wall-and-ceiling sub can sign up and try the app on
 * their own. Public on purpose (outside the (app) group, absent from
 * middleware's protected list, same as /privacy and /terms): a page you
 * must sign in to read cannot be passed around a trade association.
 *
 * EVERY FEATURE CLAIM BELOW IS CHECKED AGAINST FEATURE-AUDIT.md AND THE
 * CODE, not written from marketing instinct — this audience runs certified
 * payroll and trust-fund remittances every month and will know instantly
 * if a claim is invented. If a feature is removed, remove its line here in
 * the same commit. No fabricated logos, testimonials or member counts, and
 * no database reads: the page is static and must render fast on a phone.
 *
 * No support address is printed even though SUPPORT_EMAIL wiring exists
 * (lib/help-config.ts) — the in-app Help button reaches the same inbox
 * without publishing an address on a public page.
 */

export const metadata: Metadata = {
  title: "Try C Stream — early tester program",
  description:
    "One place for a union specialty sub's whole job — estimate, contract, crew, certified payroll evidence, billing. Sign up and try it.",
};

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-6 py-3 text-base font-semibold text-neutral-900 hover:bg-yellow-500";
const ctaQuiet =
  "inline-flex items-center justify-center rounded-md bg-neutral-800 px-5 py-3 text-sm font-medium text-ink hover:bg-neutral-700";

/** The trade list — each line exists in the app today, with the receipt in
 * the comment beside it. Keep the receipts: they are what makes the next
 * edit honest. */
const TRADE_FEATURES: { title: string; body: string }[] = [
  {
    // lib/certified-payroll.ts + /jobs/[id]/certified-payroll
    title: "Certified payroll",
    body: "WH-347-style weekly reports from your crew's actual hours — per job, per craft, per employee.",
  },
  {
    // lib/fringe-remittance.ts on /union-compliance
    title: "Trust-fund remittance",
    body: "Fringe remittance reports — pension, vacation, H&W, training — from the same hours, per agreement.",
  },
  {
    // lib/apprentice-ratio.ts — per job, per local, per day
    title: "Apprentice ratios",
    body: "Apprentice-to-journeyman ratio tracked per job, per local, per day — with an alert on any day you ran over.",
  },
  {
    // DispatchSlip on /union-compliance
    title: "Hiring-hall dispatch",
    body: "Dispatch slips recorded against the job, with the scanned slip attached.",
  },
  {
    // PrevailingWageRuleSet (/prevailing-wage) + PrevailingWageDetermination per job
    title: "Prevailing wage",
    body: "Wage determinations attached to the job, and rule sets kept per jurisdiction with effective dates.",
  },
  {
    // /lien-deadlines + alerts
    title: "Lien deadlines",
    body: "Preliminary notice and lien deadlines tracked per job, so a date does not slip past quietly.",
  },
  {
    // /rfis, /submittals, /drawings — evidence records, counters never reissued
    title: "RFIs and submittals",
    body: "Numbered, dated and never reissued — a paper trail a GC cannot argue with. Drawings live beside them.",
  },
  {
    // lib/pay-application.ts — G702/G703-style; lib/retainage.ts
    title: "Pay apps and retainage",
    body: "AIA-style pay applications (G702/G703 format) built from your schedule of values, with retainage withheld and released per job.",
  },
  {
    // DailyFieldReport (+ weather, delays), JobMedia photos, punch lists
    title: "The field, in evidence",
    body: "Daily reports with weather and delays, site photos with markups, punch lists — dated, attributable, exportable.",
  },
  {
    // Job/JobLineItem unified object — ARCHITECTURE.md; the app's own tagline
    title: "One structure, no retyping",
    body: "The estimate becomes the budget, the contract and the job-costing structure. Enter it once.",
  },
];

const FIRST_15: { title: string; body: string }[] = [
  {
    title: "Sign up",
    body: "Your company gets its own private account. Nobody outside your company sees your jobs or your numbers — not other testers, not the association.",
  },
  {
    title: "Follow the getting-started checklist",
    body: "It is on your dashboard the first time you land, and it walks you through the setup in order.",
  },
  {
    title: "Bring in your clients, jobs and crew",
    body: "Import from a spreadsheet, or connect Jobber or QuickBooks Online and pull them in — read-only, previewed before anything is saved.",
  },
  {
    title: "Ask the assistant something",
    body: "Try “what’s overdue?” or “start a bid” in the Ask box. It answers from your own data and asks before it changes anything.",
  },
  {
    title: "Take the tour",
    body: "The Help button on any screen has “Walk me through this page” and “Take the full tour.”",
  },
];

export default function PilotPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-12 sm:px-6">
      {/* ---------------------------------------------------------- header */}
      <header className="flex flex-col items-start gap-6">
        <Image
          src="/brand/cstream-wordmark.png"
          alt="C Stream"
          width={240}
          height={48}
          className="h-10 w-auto"
          priority
        />
        <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl">
          Your whole job, in one place.
        </h1>
        <p className="text-base leading-relaxed text-ink-body">
          C Stream is built for union wall-and-ceiling subcontractors &mdash; framing and drywall,
          plaster, EIFS, ceilings. The estimate, the contract, the crew, the certified payroll
          evidence and the billing live in one place, with an assistant you can ask in plain words.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Link href="/sign-up" className={cta}>
            Sign up &mdash; it takes a minute
          </Link>
          <Link href="/sign-in" className={ctaQuiet}>
            Already testing? Sign in
          </Link>
        </div>
      </header>

      {/* --------------------------------------------- first 15 minutes */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">What to try in your first 15 minutes</h2>
        <ol className="mt-5 flex flex-col gap-4">
          {FIRST_15.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-neutral-900"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold text-ink-label">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------ built for trade */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">Built for your trade</h2>
        <p className="mt-2 text-sm text-ink-body">
          Not a generic contractor app with the union parts missing. All of this is in the build
          today:
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {TRADE_FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-lg border border-line-card bg-surface p-4">
              <h3 className="font-semibold text-ink-label">{feature.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-body">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------ early build */}
      <section className="mt-14 rounded-lg border border-line-card bg-surface p-5">
        <h2 className="text-xl font-semibold text-ink">This is an early build</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-body">
          You would be among the first contractors in it, and it will show in places &mdash; some
          screens are plainer than they will be, and you will find rough edges. It also means the
          app improves weekly, and what you run into gets fixed fast. When something is wrong or
          missing, use the <strong className="font-semibold text-ink-label">Help</strong> button on
          any screen and ask a person &mdash; it reaches us directly, and we read all of it.
        </p>
      </section>

      {/* ----------------------------------------------------------- footer */}
      <footer className="mt-14 flex flex-col items-start gap-6">
        <Link href="/sign-up" className={cta}>
          Sign up and try it
        </Link>
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
