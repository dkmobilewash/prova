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
 * - SHORT. Six blocks, one content width, one card style, full-width bands
 *   between them (Cyrus approved this layout 2026-10-10, from three research
 *   passes: NN/g + Baymard + Unbounce data, Vercel/Linear/Resend measured,
 *   and a teardown of Levelset, Built, Siteline and HubSpot's free tools).
 *   The first version ran 5.5 desktop screens and said "two questions" five
 *   times; resist adding sections back — add a FAQ answer instead.
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

/** Where every yellow button goes. This page is a lead magnet (Cyrus,
 * 2026-10-10): the yellow buttons collect a sign-up; the free tool is the
 * second action, in ToolLink. */
const CTA_HREF = "/sign-up";
const CTA_LABEL = "Sign up";
const SIGN_IN_HREF = "/sign-in";

/** One content width for every block, so every section shares a left edge. */
const wrap = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";
/** Every block below the hero: a hairline above, one rhythm. */
const band = "border-t border-line-row py-16 sm:py-20";
const cta =
  "inline-flex w-full items-center justify-center rounded-md bg-brand px-8 py-4 text-lg font-semibold text-neutral-900 sm:px-10 sm:py-5 sm:text-xl transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500 sm:w-auto";
const ctaNav =
  "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500";
const quietLink = "text-sm font-medium text-ink-body transition-colors hover:text-ink";
const h2 = "font-headline text-3xl font-semibold leading-[1.05] text-ink sm:text-5xl lg:text-6xl";
const lead = "mt-4 max-w-2xl text-base leading-relaxed text-ink-body sm:text-xl";
/** The one card style on the page. */
const card = "rounded-xl border border-line-card bg-surface p-6";

/** Stagger indexes read by lienWaiverLanding.css. */
const at = (i: number, j = 0) => ({ "--i": i, "--j": j }) as CSSProperties;

/**
 * The four waivers as the 2x2 they really are: progress or final, and has
 * the money reached you yet. Risk is 1-4; unconditional final signs away
 * the job. Order is row-major (progress row first), matching the grid.
 */
const TYPES = [
  {
    name: "Conditional progress",
    when: "Progress payment · money not in yet",
    body: "Only takes effect once the payment it names actually reaches you. The one most subs send with a monthly pay app.",
    risk: 1,
  },
  {
    name: "Unconditional progress",
    when: "Progress payment · money already in",
    body: "Takes effect the moment you sign, paid or not. Meant for money already in your account.",
    risk: 2,
  },
  {
    name: "Conditional final",
    when: "Final payment · money not in yet",
    body: "Releases the whole job once final payment reaches you. Read what the form lets you hold back before you sign.",
    risk: 3,
  },
  {
    name: "Unconditional final",
    when: "Final payment · money already in",
    body: "Releases your lien rights on the whole job the moment you sign.",
    risk: 4,
  },
];
const RISK_BAR = ["bg-bar-green", "bg-bar-amber", "bg-bar-amber", "bg-bar-rose"];

const STEPS = [
  {
    title: "Pick the waiver",
    body: "Progress or final, paid yet or not. Those two answers decide which form you need.",
    instead: "Instead of guessing which form the GC wants.",
    icon: <path d="M9 11l3 3 8-8 M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" />,
  },
  {
    title: "Fill in the blanks",
    body: "Your company, the GC, the owner, the job, the amount and the through date.",
    instead: "Instead of retyping the same job details every month.",
    icon: <path d="M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4" />,
  },
  {
    title: "Download the PDF",
    body: "See the whole form first. Enter your email once to download, and we send you the PDF too.",
    // Shown while LIEN_WAIVER_TOOL_URL is unset, so this step never promises
    // a download beside "opening soon".
    bodySoon: "See the whole form first, then download the PDF. The tool opens once an attorney has reviewed the state forms.",
    instead: "Instead of a template with no way to tell where its wording came from.",
    icon: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" />,
  },
];

/**
 * The questions a sub actually has to answer before signing, in the order
 * they come up. General on purpose: no state is named and no rule is stated
 * that holds in one state and not another — where the answer depends on the
 * state, the answer says so.
 */
const FAQ: { q: string; a: string[] }[] = [
  {
    q: "What is a lien waiver?",
    a: [
      "A lien is your right to make a claim against the property if you do not get paid. A lien waiver is the receipt that gives that right up — for one payment, or for the whole job.",
      "The usual order: the GC pays you for the work you billed, you sign a waiver for that amount, and the GC passes it up to the owner and the lender so the next payment can move.",
    ],
  },
  {
    q: "Why does my GC want a lien waiver before they pay me?",
    a: [
      "Because everyone above you needs proof that the people below them are being paid. If you are not paid, you can file a lien against the property — and a lien is the owner's problem and the lender's problem, not only the GC's.",
      "So the lender will not release the next draw until the owner shows waivers, the owner will not pay the GC without them, and the GC will not pay you without yours. Your waiver is what keeps the money moving down the chain. A late or wrong one holds up your own check.",
    ],
  },
  {
    q: "Conditional or unconditional — which one do I sign?",
    a: [
      "Sign conditional whenever the money has not reached you yet. A conditional waiver only takes effect once the payment it names actually clears.",
      "Sign unconditional only for money that is already in your account. It takes effect the moment you sign, whether or not you were paid. A check in hand is not paid — it can still bounce or be held — and a joint check is not paid until it has been endorsed and cleared.",
      "The normal rhythm: send a conditional waiver with your pay application, and swap it for an unconditional one once the funds clear, if the GC asks for it.",
    ],
  },
  {
    q: "When do I sign a final waiver?",
    a: [
      "Only for the last payment on the job, and only once you know what that payment covers. A final waiver closes out your rights on the whole job, not just one month.",
      "The trap is retainage. GCs often ask for a final waiver at substantial completion, while the retainage they have held all job is still sitting with them. Sign a final waiver then without listing the retainage as an exception, and you may have just signed it away.",
      "If anything is still owed — retainage, approved change orders not yet paid, extras in dispute — check whether the form has room to hold it back. Many state forms only have a blank for disputed claims. If it does not fit, talk to the GC or an attorney before you sign.",
    ],
  },
  {
    q: "What goes in the exceptions — and what if I leave it blank?",
    a: [
      "The exceptions are where you list what this waiver does NOT give up. A blank exceptions section means you are excepting nothing, so everything the waiver covers is gone.",
      "List each item separately, with an amount and enough description that nobody can argue about what it means: retainage held to date, each unpaid change order by number, extras you have claimed but not been paid for, disputed backcharges, and any delay or impact claims you have put the GC on notice of.",
      "Not every form has room for exceptions — many only have a blank for disputed claims. If you are not sure whether something belongs there, ask before you sign.",
    ],
  },
  {
    q: "I was paid less than I billed. What do I sign?",
    a: [
      "A waiver for the amount you actually received, not the amount you billed. If the GC cut your pay application, the waiver should name the reduced number, and the difference should be listed as an exception so it is clear you are still claiming it.",
      "Signing for the full billed amount when you were short-paid tells everyone up the chain that you have been paid in full for that work. That is very hard to walk back later.",
    ],
  },
  {
    q: "What is the through date, and why does it matter?",
    a: [
      "Many waivers cover work \u201cthrough\u201d a date. Everything you did up to that date is covered by the waiver; work after it is not.",
      "Match it to the period the payment actually covers — usually the end of the pay application period. If the payment covers work through the end of last month but the waiver says through today, you may have waived the work in between without being paid for it.",
      "Not every waiver uses a through date — some forms tie the release to an invoice or a payment instead. Either way, the question is the same: does this waiver cover exactly the work this payment paid for, and nothing more?",
    ],
  },
  {
    q: "My GC sent me their own waiver form. Can I just sign that?",
    a: [
      "Read it first, carefully. A GC's own form is often broader than it needs to be: it may waive \u201call claims\u201d rather than lien rights for one payment, give up payment bond rights too, cover work you have not been paid for, or bury a release of delay claims in the fine print.",
      "In several states, a waiver has to follow the form written into the law, and a form that strays from it can be unenforceable — or can be enforced only as the law's version. That cuts both ways, so do not rely on it. Compare their form against what you are actually being paid for, and push back on anything that waives more.",
    ],
  },
  {
    q: "Does it need to be notarized?",
    a: [
      "It depends on where the job is, when the contract was signed, and what your GC or the lender asks for. Some states have required notarized waivers; most do not. Some GCs and title companies ask for a notary even when the law does not.",
      "Check before you send it. A waiver that comes back for a missing notary stamp is a payment that sits for another week.",
    ],
  },
  {
    q: "Is this legal advice?",
    a: [
      "No. The generator helps you pick between the four forms and fills them in with what you tell it. It does not know your contract, and it cannot tell you whether you should waive a particular payment, claim or dispute.",
      "If there is real money in question — a large retainage balance, a disputed change order, a GC who is not paying — talk to a construction attorney before you sign anything.",
    ],
  },
];

function Icon({ children, className = "h-7 w-7" }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/**
 * The free generator is Diego's separate app (apps/lien-waiver), on its own
 * domain. Its address comes from LIEN_WAIVER_TOOL_URL, read in the route and
 * passed down. Unset means "not launched yet": render a plain line, never a
 * link that could 404.
 */
function ToolLink({ toolUrl, center = false }: { toolUrl?: string; center?: boolean }) {
  return (
    <p className={`mt-4 text-sm text-ink-body ${center ? "text-center" : ""}`} data-lien-waiver-tool={toolUrl ? "live" : "soon"}>
      {toolUrl ? (
        <a href={toolUrl} className="inline-flex min-h-[44px] items-center font-medium text-link hover:text-link-hover">
          Or try the free waiver tool &rarr;
        </a>
      ) : (
        <>
          <span className="font-medium text-ink-label">Free waiver tool: opening soon.</span> The state forms are with
          a construction attorney for review.
        </>
      )}
    </p>
  );
}

/** Sign up, with sign-in and the tool line under it. One component so the
 * tool line can never be left off a row, or doubled. */
function SignUpRow({ toolUrl, center = false }: { toolUrl?: string; center?: boolean }) {
  return (
    <div className="mt-8">
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-4 ${center ? "justify-center" : ""}`}>
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
      <ToolLink toolUrl={toolUrl} center={center} />
    </div>
  );
}

export function LienWaiverLanding({ toolUrl }: { toolUrl?: string }) {
  return (
    <main className="pb-0">
      <header className={`${wrap} flex items-center justify-between gap-4 pt-6 sm:pt-8`}>
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

      {/* 1 · Hero. Never in <Reveal>: the first screen is there at once. The
          words stay first in the markup (screen readers meet the headline
          first); on a phone the picture is shown first by `order`, so the
          first screen is not all text. */}
      <section className={`${wrap} grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,38rem)] lg:gap-12 lg:py-14`}>
        <div className="order-2 min-w-0 lg:order-1">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-brand sm:text-base">Free lien waiver generator</p>
          <h1 className="mt-4 text-balance font-headline text-[clamp(2.75rem,6.5vw,6rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink">
            Make your lien waiver. Free.
          </h1>
          <p className={`${lead} mt-6 lg:text-2xl`}>
            Pick the right one of the four, fill in the blanks, and get a clean PDF for the GC — without retyping
            the job every month.
          </p>
          <SignUpRow toolUrl={toolUrl} />
        </div>
        {/* zoom, not transform: it scales the fixed-height stage AND its layout box together, so the clipped animation keeps its proportions and the column grows to fit. */}
        <div className="order-1 flex min-w-0 justify-center lg:order-2 lg:justify-end lg:[zoom:1.12]">
          <WaiverFill />
        </div>
      </section>

      {/* 2 · Which waiver? The 2x2 it really is, labelled. */}
      <Reveal className={band}>
        <div className={wrap}>
          <h2 className={h2}>Which waiver?</h2>
          <p className={lead}>Two questions decide it: is this a progress payment or the final one, and has the money reached you yet?</p>
          <div className="mt-10 grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:gap-4">
            <span aria-hidden className="hidden sm:block" />
            <p className="hidden text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted sm:block">Money not in yet</p>
            <p className="hidden text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted sm:block">Money already in</p>
            {[0, 1].map((row) => (
              <div key={row} className="contents">
                <p className="hidden self-center pr-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted sm:block [writing-mode:vertical-rl] rotate-180">
                  {row === 0 ? "Progress" : "Final"}
                </p>
                {TYPES.slice(row * 2, row * 2 + 2).map((t, k) => {
                  const i = row * 2 + k;
                  return (
                    <div key={t.name} className={`lw-rise ${card}`} style={at(i)}>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-lg font-semibold text-ink">{t.name}</p>
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
                      <p className="mt-1 text-xs font-medium text-ink-muted sm:hidden">{t.when}</p>
                      <p className="mt-3 text-sm leading-relaxed text-ink-body">{t.body}</p>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* 3 · The expensive mistake, as a full-width band with the ask in it. */}
      <Reveal className="border-y border-bar-amber/40 bg-tag-amber py-16 sm:py-20">
        <div className={`${wrap} lw-rise flex flex-col gap-6 sm:flex-row sm:items-start`}>
          <span className="lw-wiggle shrink-0 text-tag-amber-ink">
            <Icon className="h-12 w-12">
              <path d="M12 3 2 20h20L12 3Z M12 10v4 M12 17h.01" />
            </Icon>
          </span>
          <div className="min-w-0">
            <h2 className={h2}>Final waiver, retainage still held?</h2>
            <p className={`${lead} max-w-2xl`}>
              This is the one that costs subs real money. A final waiver closes out the job, and retainage still held
              can go with it. If retainage is still held, read the form closely — and if real money is at stake, ask a
              construction attorney before you sign.
            </p>
            <SignUpRow toolUrl={toolUrl} />
          </div>
        </div>
      </Reveal>

      {/* 4 · How it works. */}
      <Reveal className={band}>
        <div className={wrap}>
          <h2 className={h2}>How it works</h2>
          <ol className="mt-10 grid gap-3 sm:grid-cols-3 sm:gap-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className={`lw-rise ${card}`} style={at(i)}>
                <span className="lw-pop flex h-12 w-12 items-center justify-center rounded-lg bg-tag-brand-soft text-brand" style={at(i)}>
                  <Icon>{step.icon}</Icon>
                </span>
                <p className="mt-5 font-mono text-xs text-ink-muted">0{i + 1}</p>
                <p className="mt-1 text-lg font-semibold text-ink">{step.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-body">{!toolUrl && step.bodySoon ? step.bodySoon : step.body}</p>
                <p className="mt-4 border-t border-line-row pt-3 text-sm text-ink-muted">{step.instead}</p>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>

      {/* 5 · Before you sign. Native <details>, so it works with no JS. */}
      <Reveal className={band}>
        <div className={`${wrap} grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-14`}>
          <div>
            <h2 className={h2}>Before you sign</h2>
            <p className={lead}>The questions that decide whether a waiver costs you money.</p>
          </div>
          <div className="flex flex-col gap-3">
            {FAQ.map((item, i) => (
              <details key={item.q} className="lw-rise group rounded-xl border border-line-card bg-surface" style={at(i)}>
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 p-5 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span aria-hidden className="shrink-0 text-xl text-brand transition-transform duration-[var(--speed-fast)] group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="flex max-w-2xl flex-col gap-3 px-5 pb-5 text-sm leading-relaxed text-ink-body sm:text-base">
                  {item.a.map((para) => (
                    <p key={para}>{para}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </Reveal>

      {/* 6 · Close, as a full-width band. */}
      <Reveal className="border-t border-line-row bg-surface py-16 text-center sm:py-24">
        <div className={`${wrap} lw-rise`}>
          <h2 className={h2}>Your next waiver, filled in.</h2>
          <p className={`${lead} mx-auto`}>Sign up and have the next one ready before the GC asks for it.</p>
          <SignUpRow toolUrl={toolUrl} center />
        </div>
      </Reveal>
    </main>
  );
}
