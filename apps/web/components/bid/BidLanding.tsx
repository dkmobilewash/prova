import Image from "next/image";
import Link from "next/link";
import { primaryActionClass, secondaryActionClass } from "@/components/emptyStateStyles";

/**
 * THE C STREAM BID LANDING PAGE — `bid.cstream.ai/`, and `/bid` on a preview.
 *
 * Why it exists (founder's decision, 2026-10-25): a 30-year sub told us the
 * full app "does everything", so nobody can say what it is for. Bid sells ONE
 * connected chain for one trade — the invite, the walls off the drawings, the
 * price, the proposal — and this page says that in the sub's own words.
 *
 * ONE PICTURE DOES THE EXPLAINING (2026-10-26, founder's call: "simpler, one
 * big clean animation"). The hero plays one example job through the chain: the
 * invite lands, the walls draw themselves on the plan, footage counts by wall
 * type, the recap adds up, and the lit-up bid total travels onto the proposal.
 * That last move IS the promise — the number is carried, never retyped.
 *
 * It is one SVG, so it scales to a phone without reflowing, with CSS keyframes
 * generated below (no JavaScript, nothing to hydrate). Every element's resting
 * style is its FINAL frame, so `prefers-reduced-motion` (which switches the
 * animations off) shows the finished job rather than an empty box. The names
 * and figures are made up for the drawing and labelled "Example job" on screen.
 *
 * THE HONESTY RULES, the same ones components/LandingPage.tsx follows:
 *   - no pricing claims, no testimonials, no customer names. The only dollar
 *     figures on the page are inside the example job (`data-bid="example"`),
 *     and `app/bid/page.test.ts` holds everything outside it to "none";
 *   - nothing that is not built: every step drawn is a real screen;
 *   - the AI line is the product rule from ARCHITECTURE.md and CLAUDE.md, not
 *     marketing: no model reply carries a length, an area or a dollar figure;
 *   - the limits are said out loud — it finds most of the walls and you check it.
 *
 * Links go only to Bid, to the shared sign-in/sign-up (carrying Bid's
 * redirect_url so a preview brings the person back here), and to the shared
 * privacy and terms pages. `bidLinkCensus.test.ts` holds it to that.
 */

const STEPS = [
  { title: "Log the invite", body: "Paste the GC's email; the bid fills itself in." },
  { title: "Measure the walls", body: "Footage by wall type, off the drawing's own lines." },
  { title: "Price it the way your shop does", body: "Your price book, your markup, in the bid recap." },
  { title: "Send the proposal", body: "Lump sum, by scope or itemized — the same number." },
] as const;

const GIVE = ["The GC's invite — paste the email", "The drawing set, as a PDF", "Your prices, once, in your price book"] as const;
const GET = ["Wall footage by type, with the openings", "A priced estimate and bid recap", "The proposal, ready to send"] as const;

// ── THE ANIMATION ──────────────────────────────────────────────────────────
// One 12-second loop. Percentages are of the loop; everything holds its final
// frame until 94% and the whole stage fades at the end, so the loop restarts
// from a clean slate.

const LOOP_SECONDS = 12;

/** Appears at `at`% and stays. */
const fadeIn = (name: string, at: number) =>
  `@keyframes ${name}{0%,${at}%{opacity:0;transform:translateY(6px)}${at + 3}%,100%{opacity:1;transform:none}}`;

/** A wall drawing itself between `from`% and `to`% (paths use pathLength=1). */
const draw = (name: string, from: number, to: number) =>
  `@keyframes ${name}{0%,${from}%{stroke-dashoffset:1}${to}%,100%{stroke-dashoffset:0}}`;

/** A step pill lit between `from`% and `to`%. */
const lit = (name: string, from: number, to: number) =>
  `@keyframes ${name}{0%,${from}%{opacity:0}${from + 1}%,${to}%{opacity:1}${to + 1}%,100%{opacity:0}}`;

const TRAVEL = 116; // recap total (y 373) -> proposal slot (y 489), in viewBox units

const ANIMATION_CSS = [
  fadeIn("bidInvite", 2),
  lit("bidPill1", 1, 22),
  lit("bidPill2", 22, 48),
  lit("bidPill3", 48, 70),
  lit("bidPill4", 70, 95),
  fadeIn("bidPlan", 20),
  draw("bidWallsOut", 23, 36),
  draw("bidWallsIn", 32, 44),
  fadeIn("bidOpenings", 44),
  fadeIn("bidW1", 34),
  fadeIn("bidW2", 40),
  fadeIn("bidOps", 46),
  fadeIn("bidRecap", 48),
  fadeIn("bidRecap1", 52),
  fadeIn("bidRecap2", 56),
  fadeIn("bidTotal", 61),
  fadeIn("bidProposal", 68),
  `@keyframes bidTravel{0%,71%{opacity:0;transform:translateY(0)}72%{opacity:1;transform:translateY(0)}84%,100%{opacity:1;transform:translateY(${TRAVEL}px)}}`,
  `@keyframes bidStage{0%,95%{opacity:1}99%{opacity:0}100%{opacity:1}}`,
  // Resting style = final frame (what reduced motion shows).
  `.bid-anim .bt{transform:translateY(${TRAVEL}px)}`,
  `.bid-anim [data-pill]{opacity:0}`,
  `.bid-anim [data-pill="4"]{opacity:1}`,
  `@media (prefers-reduced-motion:no-preference){`,
  ...[
    ["stage", "bidStage"],
    ["invite", "bidInvite"],
    ["p1", "bidPill1"],
    ["p2", "bidPill2"],
    ["p3", "bidPill3"],
    ["p4", "bidPill4"],
    ["plan", "bidPlan"],
    ["wo", "bidWallsOut"],
    ["wi", "bidWallsIn"],
    ["op", "bidOpenings"],
    ["w1", "bidW1"],
    ["w2", "bidW2"],
    ["ops", "bidOps"],
    ["recap", "bidRecap"],
    ["r1", "bidRecap1"],
    ["r2", "bidRecap2"],
    ["total", "bidTotal"],
    ["proposal", "bidProposal"],
    ["bt", "bidTravel"],
  ].map(([cls, kf]) => `.bid-anim .${cls}{animation:${kf} ${LOOP_SECONDS}s ease-in-out infinite}`),
  `}`,
].join("");

// Colours are the app's own tokens (globals.css defines --c-* per theme), so
// the picture follows the light theme too.
const C = {
  surface: "rgb(var(--c-surface))",
  canvas: "rgb(var(--c-canvas))",
  line: "rgb(var(--c-line-card))",
  row: "rgb(var(--c-line-row))",
  ink: "rgb(var(--c-ink))",
  body: "rgb(var(--c-ink-body))",
  muted: "rgb(var(--c-ink-muted))",
  brand: "rgb(var(--c-brand))",
  brandSoft: "rgb(var(--c-tag-brand-soft))",
  brandSoftInk: "rgb(var(--c-tag-brand-soft-ink))",
  green: "rgb(var(--c-tag-green-ink))",
} as const;

const PILLS = ["Invite", "Walls", "Price", "Proposal"] as const;

function ExampleJob() {
  return (
    <figure data-bid="example" className="rounded-2xl border border-line-card bg-surface p-3 shadow-2xl shadow-black/40 sm:p-4">
      <style>{ANIMATION_CSS}</style>
      <svg
        viewBox="0 0 440 520"
        className="bid-anim block h-auto w-full"
        role="img"
        aria-label="An example job moving through C Stream Bid: the invite from Hartwell Builders arrives, the walls are measured off the floor plan as 1,240 and 680 linear feet with 14 openings, the bid recap adds up to a bid total, and that same total moves onto the lump-sum proposal without being typed again."
        fontFamily="inherit"
      >
        <g className="stage">
          {/* Step pills */}
          {PILLS.map((label, i) => {
            const x = 8 + i * 107;
            return (
              <g key={label}>
                <rect x={x} y={4} width={101} height={28} rx={14} fill="none" stroke={C.line} />
                <rect className={`p${i + 1}`} data-pill={i + 1} x={x} y={4} width={101} height={28} rx={14} fill={C.brand} />
                <text x={x + 50.5} y={23} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.muted}>
                  {i + 1} · {label}
                </text>
                <text className={`p${i + 1}`} data-pill={i + 1} x={x + 50.5} y={23} textAnchor="middle" fontSize={13} fontWeight={700} fill="#171717">
                  {i + 1} · {label}
                </text>
              </g>
            );
          })}

          {/* Where each step will land, as faint dashed outlines that line up with
              each card's edge, so the box is never empty while the job is on its
              way through. Static: under reduced motion the finished job covers them. */}
          <g aria-hidden="true" fill="none" stroke={C.row} strokeDasharray="5 4">
            <rect x={8} y={44} width={424} height={58} rx={10} />
            <rect x={8} y={114} width={252} height={180} rx={10} />
            <rect x={268} y={114} width={164} height={180} rx={10} />
            <rect x={8} y={306} width={424} height={94} rx={10} />
            <rect x={8} y={412} width={424} height={100} rx={10} />
          </g>

          {/* 1 · The invite */}
          <g className="invite">
            <rect x={8} y={44} width={424} height={58} rx={10} fill={C.canvas} stroke={C.row} />
            <text x={22} y={68} fontSize={15} fontWeight={600} fill={C.ink}>Riverside Medical Office</text>
            <text x={22} y={89} fontSize={13} fill={C.muted}>Hartwell Builders · Due Thu 2:00 PM</text>
            <rect x={354} y={60} width={64} height={24} rx={12} fill={C.brandSoft} />
            <text x={386} y={76} textAnchor="middle" fontSize={12} fontWeight={600} fill={C.brandSoftInk}>Invited</text>
          </g>

          {/* 2 · The walls */}
          <g className="plan">
            <rect x={8} y={114} width={252} height={180} rx={10} fill={C.canvas} stroke={C.row} />
            <text x={20} y={134} fontSize={11} fill={C.muted}>Sheet A-201 · 1/8&quot; = 1&apos;-0&quot;</text>
          </g>
          <path
            className="wo"
            d="M28 148 H240 V278 H28 Z"
            pathLength={1}
            strokeDasharray={1}
            fill="none"
            stroke={C.brand}
            strokeWidth={6}
            strokeLinejoin="miter"
          />
          <path
            className="wi"
            d="M108 148 V278 M172 148 V208 H240"
            pathLength={1}
            strokeDasharray={1}
            fill="none"
            stroke={C.muted}
            strokeWidth={4}
          />
          <g className="op" fill={C.green}>
            <rect x={52} y={275} width={22} height={7} rx={1.5} />
            <rect x={134} y={275} width={22} height={7} rx={1.5} />
            <rect x={104.5} y={180} width={7} height={20} rx={1.5} />
            <rect x={236.5} y={238} width={7} height={20} rx={1.5} />
          </g>
          <g className="plan">
            <rect x={268} y={114} width={164} height={180} rx={10} fill={C.canvas} stroke={C.row} />
            <text x={280} y={134} fontSize={11} fill={C.muted}>Footage by wall type</text>
          </g>
          <g className="w1">
            <rect x={280} y={152} width={12} height={4} rx={1} fill={C.muted} />
            <text x={298} y={158} fontSize={13} fill={C.body}>W1 interior</text>
            <text x={420} y={180} textAnchor="end" fontSize={17} fontWeight={700} fill={C.ink}>1,240 LF</text>
          </g>
          <g className="w2">
            <rect x={280} y={200} width={12} height={4} rx={1} fill={C.brand} />
            <text x={298} y={206} fontSize={13} fill={C.body}>W2 exterior</text>
            <text x={420} y={228} textAnchor="end" fontSize={17} fontWeight={700} fill={C.ink}>680 LF</text>
          </g>
          <g className="ops">
            <rect x={280} y={248} width={12} height={4} rx={1} fill={C.green} />
            <text x={298} y={254} fontSize={13} fill={C.body}>Doors, windows</text>
            <text x={420} y={276} textAnchor="end" fontSize={17} fontWeight={700} fill={C.ink}>14</text>
          </g>

          {/* 3 · The bid recap */}
          <g className="recap">
            <rect x={8} y={306} width={424} height={94} rx={10} fill={C.canvas} stroke={C.row} />
            <text x={22} y={326} fontSize={11} fill={C.muted}>Bid recap</text>
          </g>
          <g className="r1">
            <text x={22} y={347} fontSize={13} fill={C.body}>Direct cost</text>
            <text x={418} y={347} textAnchor="end" fontSize={13} fill={C.ink}>$64,750.00</text>
          </g>
          <g className="r2">
            <text x={22} y={366} fontSize={13} fill={C.body}>Overhead and profit</text>
            <text x={418} y={366} textAnchor="end" fontSize={13} fill={C.ink}>$13,600.00</text>
          </g>
          <g className="total">
            <text x={22} y={389} fontSize={14} fontWeight={700} fill={C.ink}>Bid total</text>
            <rect x={306} y={373} width={116} height={24} rx={6} fill={C.brandSoft} stroke={C.brand} />
            <text x={364} y={390} textAnchor="middle" fontSize={14} fontWeight={700} fill={C.brandSoftInk}>$78,350.00</text>
          </g>

          {/* 4 · The proposal */}
          <g className="proposal">
            <rect x={8} y={412} width={424} height={100} rx={10} fill={C.surface} stroke={C.line} />
            <text x={22} y={434} fontSize={11} fill={C.muted}>Proposal to Hartwell Builders</text>
            <rect x={22} y={446} width={300} height={6} rx={3} fill={C.row} />
            <rect x={22} y={460} width={240} height={6} rx={3} fill={C.row} />
            <rect x={22} y={474} width={270} height={6} rx={3} fill={C.row} />
            <text x={22} y={505} fontSize={14} fontWeight={700} fill={C.ink}>Lump sum</text>
            <rect x={306} y={489} width={116} height={24} rx={6} fill="none" stroke={C.row} strokeDasharray="4 3" />
          </g>

          {/* The same number, carried — never retyped. */}
          <g className="bt">
            <rect x={306} y={373} width={116} height={24} rx={6} fill={C.brand} />
            <text x={364} y={390} textAnchor="middle" fontSize={14} fontWeight={700} fill="#171717">$78,350.00</text>
          </g>
        </g>
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-3 text-xs text-ink-muted">
        <span className="rounded-full bg-tag-slate px-2 py-0.5 font-medium text-tag-slate-ink">Example job</span>
        <span>The total is carried from the recap to the proposal. Nobody types it twice.</span>
      </figcaption>
    </figure>
  );
}

export function BidLanding() {
  return (
    <main className="overflow-x-clip px-4 pb-16 pt-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5 sm:gap-3">
            <Image
              src="/brand/cstream-wordmark.png"
              alt="C Stream"
              width={240}
              height={48}
              className="logo-on-theme h-10 w-auto sm:h-14"
              priority
            />
            <span className="rounded-md bg-brand px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-neutral-900 sm:px-2.5 sm:py-1 sm:text-base">
              Bid
            </span>
          </span>
          <nav aria-label="Account" className="flex items-center gap-2">
            <Link
              href="/sign-in?redirect_url=%2Fbid%2Fbids"
              className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-link hover:text-link-hover hover:underline"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up?redirect_url=%2Fbid%2Fbids"
              className="hidden min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-brand-hover sm:inline-flex"
            >
              Sign up
            </Link>
          </nav>
        </header>

        <section className="mt-8 grid items-start gap-8 sm:mt-12 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
          <div className="lg:pt-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-label">
              For framing, drywall, plaster and EIFS subs
            </p>
            <h1 className="mt-3 text-balance font-headline text-4xl font-semibold leading-[1.08] text-ink sm:text-5xl lg:text-[3.5rem]">
              From the invite to the proposal, without typing the number twice.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-body">
              C Stream Bid takes a wall job from the invite to the proposal — it measures the walls off your drawings,
              prices them the way your shop does, and puts the same number on the proposal, so you never type it twice.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up?redirect_url=%2Fbid%2Fbids" className={primaryActionClass}>
                Sign up
              </Link>
              <Link href="/bid/wall-takeoff" className={secondaryActionClass}>
                Send us a drawing set — free read
              </Link>
            </div>
            {/* What goes in and what comes out — the whole product in six lines. */}
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line-card bg-surface p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">You give it</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-body">
                  {GIVE.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden="true" className="text-ink-muted">→</span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-brand/40 bg-tag-brand-soft p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">You get back</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-body">
                  {GET.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden="true" className="font-bold text-link-hover">✓</span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <ExampleJob />
        </section>

        <section aria-labelledby="bid-steps" className="mt-14 border-t border-line-row pt-10">
          <h2 id="bid-steps" className="sr-only">
            Four steps, one set of numbers
          </h2>
          <ol className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <p className="text-sm font-semibold text-link">Step {i + 1}</p>
                <h3 className="mt-0.5 font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-sm text-ink-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="bid-ai" className="mt-12 rounded-xl border border-line-card bg-surface p-5 sm:p-6">
          <h2 id="bid-ai" className="font-headline text-2xl font-semibold text-ink">
            The AI reads. It never does the maths.
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-ink-body">
            It reads addenda, spec sections, quotes and the wall legend, and tells you what it found. Every foot of
            wall, every stud and every dollar is worked out by ordinary code you can check. It finds most of the walls
            and you check it; walls drawn as a single line, and scanned sheets, you trace by hand.
          </p>
        </section>

        <section
          aria-labelledby="bid-start"
          className="mt-12 flex flex-col gap-5 rounded-xl border border-brand/40 bg-tag-brand-soft p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
        >
          <div>
            <h2 id="bid-start" className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
              Try it on your next bid
            </h2>
            <p className="mt-1 text-ink-body">Or send the drawing set first — we read it back to you, free, no account needed.</p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Link href="/sign-up?redirect_url=%2Fbid%2Fbids" className={primaryActionClass}>
              Sign up
            </Link>
            <Link href="/bid/wall-takeoff" className={secondaryActionClass}>
              Free drawing-set read
            </Link>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line-row pt-4 text-sm text-ink-muted">
          <span>C Stream Bid</span>
          <span className="flex gap-6">
            <Link href="/privacy" className="inline-flex min-h-11 items-center text-link hover:text-link-hover">
              Privacy
            </Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center text-link hover:text-link-hover">
              Terms
            </Link>
          </span>
        </footer>
      </div>
    </main>
  );
}
