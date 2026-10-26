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
 * THE HONESTY RULES, the same ones components/LandingPage.tsx follows:
 *   - no pricing claims, no testimonials, no customer names;
 *   - nothing that is not built. Every step below is a real screen in this
 *     codebase (the evidence table is in the positioning doc, section 6);
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
    body: "The GC, the project, your trade and the due date. A due-soon list keeps the week in front of you, and the bid page shows your history with that GC — bids, wins and why you lost the last one.",
  },
  {
    title: "Measure the walls",
    body: "Upload the PDF set and set the scale. It finds the walls on the floor plan from the drawing's own lines, groups them by thickness and matches them to your wall types — footage by type, without a scale ruler.",
  },
  {
    title: "Price it the way your shop does",
    body: "Each wall type knows its studs, track, board and finish, so footage turns into priced material and labour lines from your price book. Then your markup, overhead and profit go on in the bid recap.",
  },
  {
    title: "Send the proposal",
    body: "Scope, price and your standard inclusions and exclusions, printed from the same estimate. The number on the proposal is the number the recap worked out.",
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

export function BidLanding() {
  return (
    <main className="px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <div className="mx-auto max-w-5xl">
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
          <Link
            href="/sign-in?redirect_url=%2Fbid%2Fbids"
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-link hover:text-link-hover hover:underline"
          >
            Sign in
          </Link>
        </header>

        <section className="mt-12 sm:mt-16">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-label">
            For framing, drywall, plaster and EIFS subs
          </p>
          <h1 className="mt-3 font-headline text-4xl font-semibold leading-tight text-ink sm:text-6xl">
            From the invite to the proposal, without typing the number twice.
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-ink-body">
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
        </section>

        <section aria-labelledby="bid-steps" className="mt-20">
          <h2 id="bid-steps" className="font-headline text-3xl font-semibold text-ink">
            Four steps, one set of numbers
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-lg border border-line-card bg-surface p-5">
                <p className="text-sm font-semibold text-link">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm text-ink-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="bid-ai" className="mt-20">
          <h2 id="bid-ai" className="font-headline text-3xl font-semibold text-ink">
            The AI reads. It never does the maths.
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line-card bg-surface p-5">
              <h3 className="text-lg font-semibold text-ink">What the AI does</h3>
              <p className="mt-1 text-sm text-ink-body">It reads, and tells you what it found:</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-body">
                {AI_READS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-line-card bg-surface p-5">
              <h3 className="text-lg font-semibold text-ink">What ordinary code works out</h3>
              <p className="mt-1 text-sm text-ink-body">Arithmetic you can check, every time:</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-body">
                {CODE_COMPUTES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-ink-muted">
            It finds most of the walls, and you check it. Walls drawn as a single line or as solid fill, and scanned
            sheets, are not found — you trace those by hand on the drawing.
          </p>
        </section>

        <section aria-labelledby="bid-start" className="mt-20 rounded-lg border border-line-card bg-surface p-6">
          <h2 id="bid-start" className="font-headline text-3xl font-semibold text-ink">
            Try it on your next bid
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-ink-body">
            Sign up and log the invite you are working on. Or send us the drawing set first and we read it back to
            you, free — no account needed.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up?redirect_url=%2Fbid%2Fbids" className={primaryActionClass}>
              Sign up
            </Link>
            <Link href="/bid/wall-takeoff" className={secondaryActionClass}>
              Free drawing-set read
            </Link>
          </div>
        </section>

        <footer className="mt-16 flex gap-6 text-sm text-ink-muted">
          <Link href="/privacy" className="text-link hover:text-link-hover">
            Privacy
          </Link>
          <Link href="/terms" className="text-link hover:text-link-hover">
            Terms
          </Link>
        </footer>
      </div>
    </main>
  );
}
