import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { WaiverFill } from "@/components/landing/WaiverFill";

/**
 * The public landing page for the free lien waiver generator, rendered by
 * app/lien-waiver/page.tsx (kept out of the route file, as LandingPage.tsx is,
 * so the page-width and shell-port censuses treat it like the main page).
 * The generator itself is Diego's (billing lane); this page is the front
 * door to it, built on the main landing page's theme, type and motion
 * (components/LandingPage.tsx, globals.css) rather than a look of its own.
 *
 * MORE PICTURE THAN PROSE, on purpose (Cyrus, 2026-10-08). The rules it was
 * built to, each a known result rather than a taste:
 *
 * - SHOW THE PRODUCT, DON'T DESCRIBE IT. The hero's right half is the
 *   waiver filling itself in (components/landing/WaiverFill.tsx) — people
 *   remember a picture far better than a sentence (picture superiority).
 * - ONE ACTION. Every button on the page is the same action, at nav, hero
 *   and close; more choices slow the decision (Hick's law).
 * - SAY WHAT IT COSTS TO GET WRONG. A sub reads "you could give up your
 *   retainage" harder than "save time" (loss aversion), and it is true.
 * - THREE STEPS, NUMBERED. A short, visible path makes starting feel small.
 * - MOTION WITH A JOB. Transform and opacity only, at rest = finished,
 *   reduced-motion honoured twice, nothing above the fold fades in, and
 *   nothing changes height as it plays — the main page's rules, which keep
 *   layout shift at zero and the headline painting first.
 *
 * NO INVENTED NUMBERS. No "X minutes", no user counts, no testimonials —
 * the main page's rule, and the test beside this file enforces the first.
 */

/** Where every button goes. The generator is not live yet, so this is
 * sign-up for now — point it at the generator the day it ships. */
const CTA_HREF = "/sign-up";
const CTA_LABEL = "Get early access";

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-8 py-4 text-lg font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";
const ctaNav =
  "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";
const sectionSpace = "mt-16 sm:mt-24 lg:mt-[120px]";
const h2 = "font-headline text-3xl font-semibold leading-tight text-ink sm:text-4xl";

const STATES = [
  { code: "AZ", name: "Arizona", cite: "A.R.S. § 33-1008" },
  { code: "CA", name: "California", cite: "Civ. Code §§ 8132–8138" },
  { code: "NV", name: "Nevada", cite: "NRS 108.2457" },
  { code: "TX", name: "Texas", cite: "Prop. Code § 53.284" },
];

/** Risk is 1-4 bars. Unconditional final is the one that signs away the job. */
const TYPES = [
  { name: "Conditional progress", line: "Only counts once the check clears.", risk: 1 },
  { name: "Unconditional progress", line: "Counts the moment you sign. Paid first?", risk: 2 },
  { name: "Conditional final", line: "Closes the job — once the money lands.", risk: 3 },
  { name: "Unconditional final", line: "Closes the job now. Nothing left to claim.", risk: 4 },
];
const RISK_BAR = ["bg-bar-green", "bg-bar-amber", "bg-bar-amber", "bg-bar-rose"];

const STEPS = [
  { title: "Pick your state and waiver", icon: <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z M12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /> },
  { title: "Fill in the blanks", icon: <path d="M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4" /> },
  { title: "Download the PDF", icon: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" /> },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function LienWaiverLanding() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <header className="flex items-center justify-between gap-4">
        <Link href="/">
          <Image src="/brand/cstream-wordmark.png" alt="C Stream" width={240} height={48} className="h-8 w-auto sm:h-10" priority />
        </Link>
        <Link href={CTA_HREF} className={ctaNav}>
          {CTA_LABEL}
        </Link>
      </header>

      {/* Hero. Never in <Reveal>: the first screen is there at once. */}
      <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-14">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-brand">Free lien waiver generator</p>
          <h1 className="mt-4 font-headline text-[clamp(2.25rem,8vw,5rem)] font-semibold leading-[1.03] tracking-[-0.02em] text-ink">
            The state&rsquo;s own waiver. Filled in.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-body">
            Pick the right form, answer a few questions, download a clean PDF for the GC.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={CTA_HREF} className={cta}>
              {CTA_LABEL}
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-2">
            {STATES.map((s) => (
              <li key={s.code} className="rounded-md border border-line-card px-2.5 py-1 font-mono text-sm text-ink-body">
                {s.code}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 justify-center lg:justify-end">
          <WaiverFill />
        </div>
      </section>

      {/* The four states, as tiles. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>Four states. Each one&rsquo;s own form.</h2>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {STATES.map((s) => (
            <li key={s.code} className="rounded-xl border border-line-card bg-surface p-5">
              <p className="font-headline text-6xl font-semibold leading-none text-brand">{s.code}</p>
              <p className="mt-4 font-semibold text-ink">{s.name}</p>
              <p className="mt-1 font-mono text-xs text-ink-muted">{s.cite}</p>
            </li>
          ))}
        </ul>
      </Reveal>

      {/* The four types, with how much each one gives up. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>Four waivers. Signing the wrong one costs money.</h2>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {TYPES.map((t) => (
            <li key={t.name} className="rounded-xl border border-line-card bg-surface p-5">
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold text-ink">{t.name}</p>
                <span className="flex gap-1" aria-label={`Risk ${t.risk} of 4`}>
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={`h-2 w-5 rounded-full ${n <= t.risk ? RISK_BAR[t.risk - 1] : "bg-line-row"}`} />
                  ))}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-body">{t.line}</p>
            </li>
          ))}
        </ul>
      </Reveal>

      {/* Three steps. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>Three steps.</h2>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-center gap-4 rounded-xl border border-line-card bg-surface p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-tag-brand-soft text-brand">
                <Icon>{step.icon}</Icon>
              </span>
              <span>
                <span className="block font-mono text-xs text-ink-muted">0{i + 1}</span>
                <span className="block font-semibold text-ink">{step.title}</span>
              </span>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* The expensive mistake. */}
      <Reveal className={sectionSpace}>
        <div className="flex flex-col gap-5 rounded-xl border border-bar-amber/40 bg-tag-amber p-6 sm:flex-row sm:items-center sm:p-8">
          <span className="text-tag-amber-ink">
            <svg aria-hidden viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2 20h20L12 3Z M12 10v4 M12 17h.01" />
            </svg>
          </span>
          <div>
            <p className="font-headline text-2xl font-semibold text-ink sm:text-3xl">Final waiver, retainage still held?</p>
            <p className="mt-2 text-ink-body">Anything not written into the exceptions goes with it. Write it in before you sign.</p>
          </div>
        </div>
      </Reveal>

      {/* Close. */}
      <Reveal className={`${sectionSpace} text-center`}>
        <h2 className={h2}>Your next waiver, done right.</h2>
        <div className="mt-8 flex justify-center">
          <Link href={CTA_HREF} className={cta}>
            {CTA_LABEL}
          </Link>
        </div>
      </Reveal>
    </main>
  );
}
