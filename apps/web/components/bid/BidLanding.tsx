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
 * THE PROMISE IS SHOWN, NOT ONLY SAID (redesign, 2026-10-26). "You never type
 * the number twice" is the line that sells it, so the hero draws one example
 * job through all four steps with the SAME bid total lit up at the recap and on
 * the proposal. That picture is HTML in the app's own tokens, not a screenshot,
 * and it says "Example job" on screen: its names and figures are made up for
 * the drawing and are not a price for anything.
 *
 * THE HONESTY RULES, the same ones components/LandingPage.tsx follows:
 *   - no pricing claims, no testimonials, no customer names. The only dollar
 *     figures on the page are inside the example job (`data-bid="example"`),
 *     and `app/bid/page.test.ts` holds everything outside it to "none";
 *   - nothing that is not built. Every step and detail below is a real screen
 *     on this branch (bid log + paste-an-invite + same job from several GCs,
 *     takeoff + scale picker + proposed openings, recap, lump-sum / by-scope /
 *     itemized proposal + a price for each GC);
 *   - the AI line is the product rule from ARCHITECTURE.md and CLAUDE.md, not
 *     marketing: no model reply carries a length, an area or a dollar figure;
 *   - the limits are said out loud — it finds most of the walls and you check
 *     it; walls drawn as a single line or scanned sheets are traced by hand.
 *
 * Links go only to Bid, to the shared sign-in/sign-up (carrying Bid's
 * redirect_url so a preview brings the person back here), and to the shared
 * privacy and terms pages. `bidLinkCensus.test.ts` holds it to that.
 */


const STEPS = [
  {
    title: "Log the invite",
    body: "Paste the GC's email and the form fills itself in. Due dates, job walks and RFI cutoffs stay in front of you.",
  },
  {
    title: "Measure the walls",
    body: "Upload the drawing set and pick the scale. It finds the walls from the drawing's own lines and sorts the footage by wall type.",
  },
  {
    title: "Price it the way your shop does",
    body: "Your wall types price from your price book. Your markup, overhead and profit go on in the bid recap.",
  },
  {
    title: "Send the proposal",
    body: "Lump sum, by scope or itemized, printed from the same estimate. The number on it is the number the recap worked out.",
  },
] as const;

const DETAILS = [
  {
    id: "bid-detail-log",
    kicker: "Bid log",
    title: "Every invite, and the same job from every GC",
    points: [
      "Paste the invitation email and the GC, project, trade and due date fill in. Nothing saves until you say so.",
      "When three GCs invite you to the same building, it sits under one heading with one estimate.",
      "Each GC can get their own price off that one estimate, with a reason you keep to yourself.",
    ],
    visual: "log",
  },
  {
    id: "bid-detail-takeoff",
    kicker: "Takeoff",
    title: "Walls off the drawing, not off a scale ruler",
    points: [
      "Pick 1/8\", 3/16\" or 1/4\" from a list, or use the scale printed on the sheet.",
      "It finds the walls from the PDF's own lines and groups them by thickness, matched to your wall types.",
      "Doors and windows drawn in those walls are proposed for you to confirm.",
    ],
    visual: "takeoff",
  },
  {
    id: "bid-detail-recap",
    kicker: "Estimate and bid recap",
    title: "Your price book, your markup",
    points: [
      "Each wall type knows its studs, track, board and finish, so footage turns into material and labour lines.",
      "Overhead and profit go on in the recap, and the totals move as you type.",
      "When the supplier's prices change, it shows old and new on every open bid before anything moves.",
    ],
    visual: "recap",
  },
  {
    id: "bid-detail-proposal",
    kicker: "Proposal",
    title: "What the GC sees, and nothing they shouldn't",
    points: [
      "Lump sum by default, or a subtotal per wall type, or the full schedule of values.",
      "Your unit prices stay off a lump-sum or by-scope proposal.",
      "Alternates, inclusions and exclusions print from the same estimate, addressed to the GC you are sending it to.",
    ],
    visual: "proposal",
  },
] as const;

const AI_READS = [
  "addenda and spec sections, and which part of your scope they touch",
  "supplier and lower-tier quotes, into values you confirm",
  "the wall legend on the drawings",
  "whether a run of lines on a sheet is a wall",
] as const;

const CODE_COMPUTES = [
  "every foot of wall, from the PDF's own vector geometry",
  "every stud, sheet and length of track",
  "every dollar on the recap and the proposal",
] as const;

const TRADES = ["Framing", "Drywall", "Plaster", "EIFS"] as const;

// ── THE EXAMPLE JOB ────────────────────────────────────────────────────────
// Made-up names and figures for the drawing. The one figure that matters is
// BID_TOTAL, which appears at the recap AND on the proposal — that IS the
// point of the picture. Direct cost + markup add up, so a sub doing the sum in
// their head does not catch the page in a lie.
const BID_TOTAL = "$78,350.00";

function SameNumber() {
  return (
    <span className="rounded bg-tag-brand-soft px-1.5 py-0.5 font-semibold tabular-nums text-tag-brand-soft-ink ring-1 ring-brand">
      {BID_TOTAL}
    </span>
  );
}

function ExampleStep({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-9">
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-neutral-900"
      >
        {n}
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="mt-1.5 rounded-md border border-line-row bg-canvas p-3 text-sm">{children}</div>
    </li>
  );
}

function ExampleJob() {
  return (
    <figure
      data-bid="example"
      className="rounded-xl border border-line-card bg-surface p-4 shadow-2xl shadow-black/40 sm:p-5"
    >
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-line-row pb-3">
        <span className="text-sm font-semibold text-ink">One job, start to finish</span>
        <span className="rounded-full bg-tag-slate px-2 py-0.5 text-xs font-medium text-tag-slate-ink">Example job</span>
      </figcaption>
      <ol className="mt-4 space-y-4">
        <ExampleStep n={1} label="The invite">
          <p className="font-medium text-ink">Riverside Medical Office, Level 2</p>
          <p className="text-ink-muted">Hartwell Builders · Due Thu 2:00 PM</p>
        </ExampleStep>
        <ExampleStep n={2} label="The walls">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-ink-body">
            <dt className="min-w-0 truncate">W1 · 3-5/8&quot; stud, board both sides</dt>
            <dd className="tabular-nums text-ink">1,240 LF</dd>
            <dt className="min-w-0 truncate">W2 · 6&quot; stud, rated</dt>
            <dd className="tabular-nums text-ink">680 LF</dd>
            <dt className="min-w-0 truncate text-ink-muted">Doors and windows found</dt>
            <dd className="tabular-nums text-ink-muted">14</dd>
          </dl>
        </ExampleStep>
        <ExampleStep n={3} label="The bid recap">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-ink-body">
            <dt>Direct cost</dt>
            <dd className="tabular-nums text-ink">$64,750.00</dd>
            <dt>Overhead and profit</dt>
            <dd className="tabular-nums text-ink">$13,600.00</dd>
            <dt className="font-semibold text-ink">Bid total</dt>
            <dd>
              <SameNumber />
            </dd>
          </dl>
        </ExampleStep>
        <ExampleStep n={4} label="The proposal">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-ink-body">Lump sum for the work described</span>
            <SameNumber />
          </div>
        </ExampleStep>
      </ol>
      <p className="mt-4 text-xs text-ink-muted">
        The lit-up figure is the same number, carried from the recap to the proposal. Nobody typed it twice.
      </p>
    </figure>
  );
}

// ── THE SMALL PICTURES BESIDE EACH DETAIL ──────────────────────────────────
// Decorative (aria-hidden): every fact in them is also in the text beside
// them, so a screen reader loses nothing. No dollar figures in any of them.

function MiniCard({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="rounded-xl border border-line-card bg-surface p-4 text-sm sm:p-5">
      {children}
    </div>
  );
}

function LogVisual() {
  return (
    <MiniCard>
      <p className="font-semibold text-ink">Riverside Medical Office</p>
      <p className="text-xs text-ink-muted">Same job, 3 GCs · one estimate</p>
      <ul className="mt-3 divide-y divide-line-row">
        {[
          ["Hartwell Builders", "Submitted", "bg-tag-green text-tag-green-ink"],
          ["Okafor Construction", "Invited", "bg-tag-amber text-tag-amber-ink"],
          ["Brightline GC", "Invited", "bg-tag-amber text-tag-amber-ink"],
        ].map(([gc, status, tone]) => (
          <li key={gc} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-ink-body">{gc}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>
          </li>
        ))}
      </ul>
    </MiniCard>
  );
}

function TakeoffVisual() {
  return (
    <MiniCard>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-ink">Sheet A-201</p>
        <span className="rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-label">1/8&quot; = 1&apos;-0&quot;</span>
      </div>
      <svg viewBox="0 0 240 120" className="mt-3 h-auto w-full" role="presentation">
        <rect x="1" y="1" width="238" height="118" rx="4" className="fill-canvas stroke-line-row" strokeWidth="1" />
        <g className="stroke-brand" strokeWidth="5" strokeLinecap="square">
          <path d="M20 20 H220 V100 H20 Z" fill="none" />
        </g>
        <g className="stroke-ink-muted" strokeWidth="3" strokeLinecap="square">
          <path d="M100 20 V100 M160 20 V60 H220" fill="none" />
        </g>
        <g className="fill-tag-green-ink">
          <rect x="52" y="97" width="18" height="6" rx="1" />
          <rect x="127" y="97" width="18" height="6" rx="1" />
          <rect x="97" y="48" width="6" height="16" rx="1" />
        </g>
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5 text-ink-body">
          <span className="h-1.5 w-4 rounded-sm bg-brand text-neutral-900" /> W2 exterior
        </span>
        <span className="flex items-center gap-1.5 text-ink-body">
          <span className="h-1.5 w-4 rounded-sm bg-ink-muted" /> W1 interior
        </span>
        <span className="flex items-center gap-1.5 text-ink-body">
          <span className="h-1.5 w-4 rounded-sm bg-tag-green-ink" /> openings to confirm
        </span>
      </div>
    </MiniCard>
  );
}

function RecapVisual() {
  return (
    <MiniCard>
      <p className="font-semibold text-ink">Bid recap</p>
      <dl className="mt-3 divide-y divide-line-row text-ink-body">
        {[
          ["Material", "from your price book"],
          ["Labour", "from your production rates"],
          ["Overhead and profit", "your rates"],
          ["Bid total", "carried to the proposal"],
        ].map(([label, note], i, all) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt className={i === all.length - 1 ? "font-semibold text-ink" : ""}>{label}</dt>
            <dd className="text-right text-xs text-ink-muted">{note}</dd>
          </div>
        ))}
      </dl>
    </MiniCard>
  );
}

function ProposalVisual() {
  return (
    <MiniCard>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {["Lump sum", "By scope", "Itemized"].map((mode, i) => (
          <span
            key={mode}
            className={
              i === 0
                ? "rounded-md bg-brand px-2.5 py-1 font-semibold text-neutral-900"
                : "rounded-md border border-line-card px-2.5 py-1 text-ink-label"
            }
          >
            {mode}
          </span>
        ))}
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">Proposal to Hartwell Builders</p>
      <div className="mt-2 space-y-2">
        <div className="h-2 w-11/12 rounded-sm bg-line-row" />
        <div className="h-2 w-9/12 rounded-sm bg-line-row" />
        <div className="h-2 w-10/12 rounded-sm bg-line-row" />
      </div>
      <p className="mt-4 text-sm text-ink-body">
        Inclusions · Exclusions · Alternates
      </p>
    </MiniCard>
  );
}

const VISUALS = { log: LogVisual, takeoff: TakeoffVisual, recap: RecapVisual, proposal: ProposalVisual } as const;

export function BidLanding() {
  return (
    <main className="overflow-x-clip px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <Image
              src="/brand/cstream-wordmark.png"
              alt="C Stream"
              width={240}
              height={48}
              className="logo-on-theme h-8 w-auto sm:h-10"
              priority
            />
            <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-900">
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

        {/* ── HERO ── */}
        <section className="mt-10 grid items-center gap-10 sm:mt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-label">
              For framing, drywall, plaster and EIFS subs
            </p>
            <h1 className="mt-3 text-balance font-headline text-4xl font-semibold leading-[1.1] text-ink sm:text-5xl lg:text-6xl">
              From the invite to the proposal, without typing the number twice.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-body">
              C Stream Bid takes a wall job from the invite to the proposal — it measures the walls off your drawings,
              prices them the way your shop does, and puts the same number on the proposal, so you never type it twice.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up?redirect_url=%2Fbid%2Fbids" className={primaryActionClass}>
                Sign up
              </Link>
              <Link href="/bid/wall-takeoff" className={secondaryActionClass}>
                Send us a drawing set — free read
              </Link>
            </div>
            <p className="mt-3 text-sm text-ink-muted">The free read needs no account.</p>
          </div>
          <ExampleJob />
        </section>

        {/* ── THE CHAIN ── */}
        <section aria-labelledby="bid-steps" className="mt-24">
          <h2 id="bid-steps" className="font-headline text-3xl font-semibold text-ink sm:text-4xl">
            Four steps, one set of numbers
          </h2>
          <p className="mt-3 max-w-2xl text-ink-body">
            Each step hands its numbers to the next. Change a wall and the price, the recap and the proposal follow.
          </p>
          <ol className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative">
                {i < STEPS.length - 1 && (
                  <span aria-hidden="true" className="absolute left-12 right-0 top-4 hidden h-px bg-line-card lg:block" />
                )}
                <span
                  aria-hidden="true"
                  className="relative flex h-8 w-8 items-center justify-center rounded-full border border-brand bg-canvas text-sm font-bold text-link-hover"
                >
                  {i + 1}
                </span>
                <p className="mt-4 text-sm font-semibold text-link">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm text-ink-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── THE DETAIL ── */}
        <div className="mt-24 space-y-20 sm:space-y-24">
          {DETAILS.map((detail, i) => {
            const Visual = VISUALS[detail.visual];
            return (
              <section
                key={detail.id}
                aria-labelledby={detail.id}
                className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
              >
                <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
                  <p className="text-sm font-semibold uppercase tracking-wide text-link">{detail.kicker}</p>
                  <h2 id={detail.id} className="mt-2 font-headline text-2xl font-semibold text-ink sm:text-3xl">
                    {detail.title}
                  </h2>
                  <ul className="mt-5 space-y-3">
                    {detail.points.map((point) => (
                      <li key={point} className="flex gap-3 text-ink-body">
                        <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand text-neutral-900" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={i % 2 === 1 ? "lg:order-1" : undefined}>
                  <Visual />
                </div>
              </section>
            );
          })}
        </div>

        {/* ── WHO DOES THE MATHS ── */}
        <section aria-labelledby="bid-ai" className="mt-24 rounded-xl border border-line-card bg-surface p-5 sm:p-8">
          <h2 id="bid-ai" className="font-headline text-3xl font-semibold text-ink">
            The AI reads. It never does the maths.
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-ink">What the AI does</h3>
              <p className="mt-1 text-sm text-ink-muted">It reads, and tells you what it found:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-body">
                {AI_READS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-ink">What ordinary code works out</h3>
              <p className="mt-1 text-sm text-ink-muted">Arithmetic you can check, every time:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-body">
                {CODE_COMPUTES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-6 border-t border-line-row pt-4 text-sm text-ink-muted">
            It finds most of the walls, and you check it. Walls drawn as a single line or as solid fill, and scanned
            sheets, are not found — you trace those by hand on the drawing.
          </p>
        </section>

        {/* ── WHO IT IS FOR ── */}
        <section aria-labelledby="bid-for" className="mt-24">
          <h2 id="bid-for" className="font-headline text-3xl font-semibold text-ink">
            Built for the sub, not the GC
          </h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {TRADES.map((trade) => (
              <li key={trade} className="rounded-full border border-line-card px-4 py-1.5 text-sm font-medium text-ink-label">
                {trade}
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-2xl text-ink-body">
            It is the same account as C Stream. If your shop later runs its contracts, billing and field work there,
            every job you priced here is already in it.
          </p>
        </section>

        {/* ── CLOSE ── */}
        <section
          aria-labelledby="bid-start"
          className="mt-24 rounded-xl border border-brand/40 bg-tag-brand-soft p-6 sm:p-10"
        >
          <h2 id="bid-start" className="font-headline text-3xl font-semibold text-ink sm:text-4xl">
            Try it on your next bid
          </h2>
          <p className="mt-3 max-w-2xl text-ink-body">
            Sign up and log the invite you are working on. Or send us the drawing set first and we read it back to
            you, free — no account needed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up?redirect_url=%2Fbid%2Fbids" className={primaryActionClass}>
              Sign up
            </Link>
            <Link href="/bid/wall-takeoff" className={secondaryActionClass}>
              Free drawing-set read
            </Link>
          </div>
        </section>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line-row pt-6 text-sm text-ink-muted">
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
