import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { WaiverFill } from "@/components/landing/WaiverFill";
import "./lienWaiverLanding.css";

/**
 * The public landing page for the free lien waiver generator, rendered by
 * app/lien-waiver/page.tsx (kept out of the route file, as LandingPage.tsx is,
 * so the page-width and shell-port censuses treat it like the main page).
 * The generator itself is Diego's (billing lane); this page is the front
 * door to it, built on the main landing page's theme, type and motion
 * (components/LandingPage.tsx, globals.css) rather than a look of its own.
 *
 * NO STATE IS NAMED (Cyrus, 2026-10-08): the page speaks to every sub, not
 * to a list of states, so nobody reads it and decides it is not for them.
 *
 * MORE PICTURE THAN PROSE, on purpose. The rules it was built to, each a
 * known result rather than a taste:
 *
 * - SHOW THE PRODUCT, DON'T DESCRIBE IT. The hero's right half is the
 *   waiver filling itself in (components/landing/WaiverFill.tsx) — people
 *   remember a picture far better than a sentence (picture superiority).
 * - ONE ACTION. Every yellow button is the same action, repeated down the
 *   page so it is always one glance away; more choices slow the decision
 *   (Hick's law). "Sign in" is a quiet link, never a second yellow button.
 * - SAY WHAT IT COSTS TO GET WRONG. A sub reads "you could give up your
 *   retainage" harder than "save time" (loss aversion), and it is true.
 * - THREE STEPS, NUMBERED. A short, visible path makes starting feel small.
 * - MOTION WITH A JOB. Every section below the hero arrives in a stagger
 *   (lienWaiverLanding.css), keyed on Reveal's own "visible" state, so it
 *   only plays for a section that was confirmed off-screen first and then
 *   scrolled to. At rest — no JS, reduced motion, or already on screen at
 *   load — everything is simply there. Transform and opacity only, nothing
 *   changes height, nothing above the fold fades in.
 *
 * NO INVENTED NUMBERS. No "X minutes", no user counts, no testimonials —
 * the main page's rule, and the test beside the route enforces the first.
 */

/** Where every yellow button goes. The generator is not live yet, so this
 * is sign-up for now — point it at the generator the day it ships. */
const CTA_HREF = "/sign-up";
const CTA_LABEL = "Sign up";
const SIGN_IN_HREF = "/sign-in";

const cta =
  "inline-flex items-center justify-center rounded-md bg-brand px-8 py-4 text-lg font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";
const ctaNav =
  "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";
const quietLink = "text-sm font-medium text-ink-body transition-colors hover:text-ink";
const sectionSpace = "mt-16 sm:mt-24 lg:mt-[120px]";
const h2 = "font-headline text-3xl font-semibold leading-tight text-ink sm:text-4xl";
const lead = "mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-lg";
const card = "rounded-xl border border-line-card bg-surface p-5";

/** Stagger indexes read by lienWaiverLanding.css. */
const at = (i: number, j = 0) => ({ "--i": i, "--j": j }) as CSSProperties;

const WHAT_IT_IS = [
  {
    title: "You get paid",
    body: "The GC sends a check for the work you billed this month.",
    icon: <path d="M3 7h18v10H3z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M6.5 12h.01 M17.5 12h.01" />,
  },
  {
    title: "You sign a waiver",
    body: "It says you give up your right to file a lien for the amount you were paid.",
    icon: <path d="M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4" />,
  },
  {
    title: "Everyone has proof",
    body: "The GC passes it up to the owner and the lender, and the next payment moves.",
    icon: <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z M8.5 12l2.5 2.5 4.5-5" />,
  },
];

/** Risk is 1-4. Unconditional final is the one that signs away the job. */
const TYPES = [
  {
    name: "Conditional progress",
    when: "Monthly billing, before the check clears",
    body: "Only takes effect once the payment it names actually reaches you. The safe default for a progress payment.",
    risk: 1,
  },
  {
    name: "Unconditional progress",
    when: "Monthly billing, money already in the bank",
    body: "Takes effect the moment you sign, paid or not. Sign it only for money you already have.",
    risk: 2,
  },
  {
    name: "Conditional final",
    when: "Last payment on the job, before it clears",
    body: "Releases the whole job once final payment reaches you. Anything still owed has to be listed as an exception.",
    risk: 3,
  },
  {
    name: "Unconditional final",
    when: "Job closed, every dollar in",
    body: "Releases everything, immediately. After this there is nothing left to claim on the job.",
    risk: 4,
  },
];
const RISK_BAR = ["bg-bar-green", "bg-bar-amber", "bg-bar-amber", "bg-bar-rose"];

const STEPS = [
  {
    title: "Pick the waiver",
    body: "Progress or final, paid yet or not. Those two answers decide which form you need.",
    icon: <path d="M9 11l3 3 8-8 M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" />,
  },
  {
    title: "Fill in the blanks",
    body: "Your company, the GC, the job, the amount — and anything you are still owed, so it is not waived by accident.",
    icon: <path d="M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4" />,
  },
  {
    title: "Download the PDF",
    body: "A clean PDF, ready to sign and send to the GC.",
    icon: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" />,
  },
];

const FAQ = [
  {
    q: "What is the difference between conditional and unconditional?",
    a: "A conditional waiver only counts once the payment actually reaches you. An unconditional one counts the moment you sign. If the check has not cleared, sign conditional.",
  },
  {
    q: "What is the difference between progress and final?",
    a: "A progress waiver covers one payment — usually a monthly pay application. A final waiver covers the whole job and is meant for the last payment.",
  },
  {
    q: "What goes in the exceptions?",
    a: "Anything you are still owed that this waiver should not give up: retainage still being held, change orders not yet paid, disputed extras. If it is not written there, the waiver can give it away.",
  },
  {
    q: "Does it need to be notarized?",
    a: "It depends on where the job is and what your GC asks for. Check before you send it.",
  },
];

function Icon({ children, className = "h-7 w-7" }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function SignUpRow({ center = false }: { center?: boolean }) {
  return (
    <div className={`mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 ${center ? "justify-center" : ""}`}>
      <Link href={CTA_HREF} className={cta}>
        {CTA_LABEL}
      </Link>
      <span className="text-sm text-ink-body">
        Already have an account?{" "}
        <Link href={SIGN_IN_HREF} className="font-medium text-link hover:text-link-hover">
          Sign in
        </Link>
      </span>
    </div>
  );
}

export function LienWaiverLanding() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <header className="flex items-center justify-between gap-4">
        <Link href="/">
          <Image src="/brand/cstream-wordmark.png" alt="C Stream" width={240} height={48} className="h-8 w-auto sm:h-10" priority />
        </Link>
        <nav className="flex items-center gap-5">
          <Link href={SIGN_IN_HREF} className={quietLink}>
            Sign in
          </Link>
          <Link href={CTA_HREF} className={ctaNav}>
            {CTA_LABEL}
          </Link>
        </nav>
      </header>

      {/* Hero. Never in <Reveal>: the first screen is there at once. */}
      <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-14 lg:py-20">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-brand">Free lien waiver generator</p>
          <h1 className="mt-4 font-headline text-[clamp(2.25rem,8vw,5rem)] font-semibold leading-[1.03] tracking-[-0.02em] text-ink">
            The right waiver. Filled in.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-body">
            Your GC wants a lien waiver before every payment. Pick the right one, answer a few questions, and
            download a clean PDF — without giving away money you are still owed.
          </p>
          <SignUpRow />
        </div>
        <div className="flex min-w-0 justify-center lg:justify-end">
          <WaiverFill />
        </div>
      </section>

      {/* What a lien waiver is. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>What is a lien waiver?</h2>
        <p className={lead}>
          A lien is your right to make a claim against the property if you do not get paid. A waiver is the
          receipt that gives that right up — for one payment, or for the whole job.
        </p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {WHAT_IT_IS.map((item, i) => (
            <li key={item.title} className={`lw-rise ${card}`} style={at(i)}>
              <span className="lw-pop flex h-12 w-12 items-center justify-center rounded-lg bg-tag-brand-soft text-brand" style={at(i)}>
                <Icon>{item.icon}</Icon>
              </span>
              <p className="mt-4 font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-body">{item.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* The four types, with how much each one gives up. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>Four waivers. Signing the wrong one costs money.</h2>
        <p className={lead}>
          Two questions decide which one you need: is this a progress payment or the final one, and has the
          money actually reached you yet?
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {TYPES.map((t, i) => (
            <li key={t.name} className={`lw-rise ${card}`} style={at(i)}>
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold text-ink">{t.name}</p>
                <span className="flex shrink-0 gap-1" role="img" aria-label={`Risk ${t.risk} of 4`}>
                  {[1, 2, 3, 4].map((n) => (
                    <span
                      key={n}
                      className={`lw-seg h-2 w-5 rounded-full ${n <= t.risk ? RISK_BAR[t.risk - 1] : "bg-line-row"}`}
                      style={at(i, n)}
                    />
                  ))}
                </span>
              </div>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">{t.when}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-body">{t.body}</p>
            </li>
          ))}
        </ul>
        <SignUpRow />
      </Reveal>

      {/* Three steps. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>Three steps.</h2>
        <p className={lead}>No legal language to write. You answer plain questions; the form fills itself in.</p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className={`lw-rise ${card}`} style={at(i)}>
              <div className="flex items-center gap-4">
                <span className="lw-pop flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-tag-brand-soft text-brand" style={at(i)}>
                  <Icon>{step.icon}</Icon>
                </span>
                <span>
                  <span className="block font-mono text-xs text-ink-muted">0{i + 1}</span>
                  <span className="block font-semibold text-ink">{step.title}</span>
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-ink-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* The expensive mistake. */}
      <Reveal className={sectionSpace}>
        <div className="lw-rise flex flex-col gap-5 rounded-xl border border-bar-amber/40 bg-tag-amber p-6 sm:flex-row sm:items-center sm:p-8">
          <span className="lw-wiggle shrink-0 text-tag-amber-ink">
            <Icon className="h-12 w-12">
              <path d="M12 3 2 20h20L12 3Z M12 10v4 M12 17h.01" />
            </Icon>
          </span>
          <div>
            <p className="font-headline text-2xl font-semibold text-ink sm:text-3xl">Final waiver, retainage still held?</p>
            <p className="mt-2 max-w-3xl leading-relaxed text-ink-body">
              This is the one that costs subs real money. A final waiver closes out the job, and anything not
              written into the exceptions goes with it — retainage included. List what you are still owed
              before you sign.
            </p>
          </div>
        </div>
      </Reveal>

      {/* Questions. Native <details>, so it works with no JavaScript. */}
      <Reveal className={sectionSpace}>
        <h2 className={h2}>Common questions</h2>
        <div className="mt-8 flex flex-col gap-3">
          {FAQ.map((item, i) => (
            <details key={item.q} className="lw-rise group rounded-xl border border-line-card bg-surface" style={at(i)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden className="shrink-0 text-xl text-brand transition-transform duration-[var(--speed-fast)] group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 text-sm leading-relaxed text-ink-body">{item.a}</p>
            </details>
          ))}
        </div>
      </Reveal>

      {/* Close. */}
      <Reveal className={`${sectionSpace} text-center`}>
        <div className="lw-rise rounded-2xl border border-line-card bg-surface px-6 py-12 sm:py-16">
          <h2 className={h2}>Your next waiver, done right.</h2>
          <p className={`${lead} mx-auto`}>Sign up and have the next one ready before the GC asks for it.</p>
          <SignUpRow center />
        </div>
      </Reveal>
    </main>
  );
}
