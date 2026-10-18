import Image from "next/image";
import { Reveal } from "@/components/Reveal";
import { SheetReadFigure } from "@/components/landing/SheetReadFigure";
import { TakeoffOfferForm } from "@/components/TakeoffOfferForm";
import { DELIVERABLES, DELIVERY, LIMITS, NEXT_STEPS, OUTCOMES, WHAT_IT_FEEDS } from "@/lib/takeoff-offer";

/**
 * `/wall-takeoff` — the free drawing-set read, for a specialty-trade sub we
 * are trying to sell to. Handed out as a bare link in outreach, so it is
 * public and it is often opened on a phone, standing up, between other things.
 *
 * ── REBUILT 2026-10-08, AND THE REASON IS THE ONLY THING WORTH READING HERE ──
 *
 * The first version explained the offer in four card sections — every
 * deliverable with its body and its "check it in ten seconds" line, then the
 * limits, then how it works, then where it goes — above the form. About four
 * hundred words before the ask. It was accurate, it was honest, and the
 * founder's verdict on it was that a sub should know what this is by LOOKING
 * at the page. He was right: nobody reads four hundred words off a link in a
 * text message, and a page that has to be read before it is understood has
 * already lost the reader it was built for.
 *
 * So the order is now: ONE claim, THE PICTURE, three outcomes, the ask — and
 * the enumerated lists underneath, in small type, for whoever scrolls.
 * `SheetReadFigure` carries the explanation: a drawing on the left, the list
 * that came off it on the right, a line sweeping down as the rows fill in.
 * The figure is the argument; the words are the footnotes.
 *
 * ── WHY THE LISTS ARE STILL ALL RENDERED, AND WHY THAT IS NOT A COMPROMISE ──
 *
 * `takeoff-offer.test.ts` requires this component to map over DELIVERABLES,
 * WHAT_IT_FEEDS, LIMITS and NEXT_STEPS, and the reason is in its own message:
 * a promise that can drift between the page and the email is a promise we did
 * not keep. The tempting move when simplifying was to drop the lists and
 * write a short page in fresh prose. That is exactly the drift the census
 * exists to stop — the email would still promise four things while the page
 * promised three, and nothing would notice.
 *
 * So the simplification is one of ORDER AND TYPE SIZE, never of content: the
 * same lists, the same single source, moved below the ask and set small.
 * Nothing on this page is a hand-written restatement of anything in
 * `lib/takeoff-offer.ts` — the duplicate-literal half of that census would
 * fail the build if it were.
 *
 * ── THE ASK COMES BEFORE THE DETAIL ──
 *
 * The form used to be last, after every section that justified it. A reader
 * convinced by the figure had to scroll past four hundred words to act, and a
 * reader not convinced by the figure was not going to be convinced by the
 * fourth section either. So the ask sits directly under the outcomes, and the
 * detail is for the reader who wants it before deciding — which is a smaller
 * group than the one that wants it after.
 *
 * ── THE LIMITS ARE STILL SET IN THE SAME TYPE SIZE AS THE PROMISES ──
 *
 * Kept verbatim from the first version, because it is the rule most likely to
 * be quietly broken by a redesign: what we will not do is set at the same
 * size and weight as what we will. An offer whose caveats are smaller than
 * its promises is an offer that expects not to be read carefully, and this
 * one is going to a person who has been burned by exactly that.
 *
 * The column is capped here rather than in `app/wall-takeoff/page.tsx`
 * because `lib/pageWidthCensus.test.ts` refuses a width cap in a route file.
 * `max-w-5xl` rather than the main landing page's `max-w-6xl`: this page is
 * one figure and a form, and at 1152 the hero reads as a sentence adrift in a
 * field.
 */
export function WallTakeoffOffer({ open, sendTo }: { open: boolean; sendTo: string | null }) {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      {/* ---------------------------------------------------------- the claim
          No <Reveal> above the fold, the same rule the main landing page
          holds: content that fades in on load reads as lag, not polish. */}
      <header className="flex flex-col items-start gap-6">
        <Image
          src="/brand/cstream-wordmark.png"
          alt="C Stream"
          width={240}
          height={48}
          className="h-8 w-auto sm:h-10"
          priority
        />
        <h1 className="font-headline text-4xl font-semibold leading-[1.03] tracking-[-0.02em] text-ink sm:text-5xl lg:text-6xl">
          Send your drawings.
          <br />
          Get back the list.
        </h1>
        <p className="text-lg leading-relaxed text-ink-body sm:text-xl">
          Free, no account, and normally {DELIVERY.turnaround}.
        </p>
      </header>

      {/* ----------------------------------------------------- the explanation
          This figure is the page. Everything below it is detail. */}
      <SheetReadFigure />

      {/* -------------------------------------------------------- the outcomes
          Three lines, bold lead and muted tail, each one tied to a deliverable
          by `from` so a benefit cannot outlive its basis. */}
      <section className="mt-12 border-t border-line-row pt-7 sm:mt-14">
        <h2 className="sr-only">What it gets you</h2>
        <ul className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          {OUTCOMES.map((outcome) => (
            <li key={outcome.from} className="flex min-w-0 flex-1 gap-2.5 text-sm leading-relaxed">
              <span aria-hidden className="shrink-0 font-bold text-brand">
                &#8212;
              </span>
              <p className="min-w-0">
                <strong className="font-bold text-ink">{outcome.lead}</strong>{" "}
                <span className="text-ink-muted">{outcome.tail}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------- the ask */}
      <section className="mt-12 sm:mt-14">
        {open ? (
          <>
            <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
              Where should we send it?
            </h2>
            <p className="mt-2 text-base leading-relaxed text-ink-body">
              {/* The address is named IN the sentence rather than sitting in a
                  box beside it: `takeoff-offer.test.ts` asserts that, because
                  the one thing a reader must leave this page knowing is where
                  the set goes. */}
              {sendTo ? (
                <>
                  Three fields, then send the set to{" "}
                  {/* A live mailto, not plain text: this page is opened on a
                      phone more often than not, and a tappable address is the
                      difference between sending the set now and meaning to
                      later. Asserted by `WallTakeoffOffer.test.ts`. */}
                  <a className="text-link underline hover:text-link-hover" href={`mailto:${sendTo}`}>
                    {sendTo}
                  </a>
                  .
                </>
              ) : (
                "Three fields are needed. The rest just helps us read the set faster."
              )}
            </p>
            <div className="mt-5">
              <TakeoffOfferForm />
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-line-card bg-surface p-5 sm:p-6">
            <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
              The free read is not open at the moment
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-body">
              There is nowhere for a drawing set to arrive right now, so we are not taking your
              details &mdash; collecting them against a read nobody can do would leave you waiting
              for an email that is waiting for you.
            </p>
            <p className="mt-3 text-base leading-relaxed text-ink-body">
              It opens again shortly. Go back to whoever sent you this link and they will tell you
              when.
            </p>
          </div>
        )}
      </section>

      {/* ============================ THE DETAIL, BELOW THE ASK ==============
          Everything from here down is for the reader who wants the whole of it
          before deciding. Small type, one source, no restatement. */}

      <Reveal className="mt-16 border-t border-line-card pt-10 sm:mt-20">
        <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
          What you get back
        </h2>
        <ul className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {DELIVERABLES.map((deliverable) => (
            <li key={deliverable.id} className="min-w-0">
              <p className="text-sm font-semibold text-ink-label">{deliverable.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-body">{deliverable.body}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-tag-green-ink">
                {deliverable.check}
              </p>
            </li>
          ))}
        </ul>
        {/* What he can DO with it once it lands — rendered from DELIVERY so it
            cannot drift from the email that makes the same promise. */}
        <p className="mt-5 text-sm leading-relaxed text-ink-body">{DELIVERY.shareable}</p>
      </Reveal>

      <Reveal className="mt-12">
        <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">How it works</h2>
        <ol className="mt-5 flex flex-col gap-3">
          {NEXT_STEPS.map((step) => (
            <li key={step.step} className="flex gap-3 text-sm leading-relaxed">
              <span className="shrink-0 font-mono text-xs text-ink-muted">
                {String(step.step).padStart(2, "0")}
              </span>
              <p className="min-w-0">
                <strong className="font-semibold text-ink-label">{step.title}</strong>{" "}
                <span className="text-ink-body">{step.body}</span>
              </p>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal className="mt-12">
        <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
          Where it goes from there
        </h2>
        <ul className="mt-5 flex flex-col gap-4">
          {WHAT_IT_FEEDS.map((fed) => (
            <li key={fed.id} className="text-sm leading-relaxed">
              <p className="font-semibold text-ink-label">{fed.handed}</p>
              <p className="mt-1 text-ink-body">{fed.feeds}</p>
            </li>
          ))}
        </ul>
      </Reveal>

      {/* The limits, at the promises' own size. See the header. */}
      <Reveal className="mt-12">
        <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
          What we will not do
        </h2>
        <ul className="mt-5 flex flex-col gap-3">
          {LIMITS.map((limit) => (
            <li key={limit} className="flex gap-3 text-sm leading-relaxed text-ink-body">
              <span aria-hidden className="mt-0.5 shrink-0 text-brand">
                &#8212;
              </span>
              <span className="min-w-0">{limit}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </main>
  );
}
