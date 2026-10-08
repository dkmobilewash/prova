import Image from "next/image";
import { TakeoffOfferForm } from "@/components/TakeoffOfferForm";
import { DELIVERABLES, DELIVERY, LIMITS, NEXT_STEPS } from "@/lib/takeoff-offer";

/**
 * The visitor-facing content of `/wall-takeoff` — the free drawing-set read,
 * handed out by hand in outreach to specialty-trade subs.
 *
 * It lives here rather than in `app/wall-takeoff/page.tsx` for the reason
 * `components/LandingPage.tsx` does: Next's page-file type checking rejects
 * any named export from a page module besides the ones it recognises, and
 * `lib/pageWidthCensus.test.ts` polices width caps in ROUTE files with an
 * exemption list that only shrinks. The column below is a width decision, so
 * it belongs in a component. The route file is `metadata` and a default
 * export, and nothing else.
 *
 * ── EVERY PROMISE IS RENDERED FROM `lib/takeoff-offer.ts` ──
 *
 * Not one deliverable title, body or limit is typed into this file.
 * `lib/takeoff-offer.test.ts` walks every source file under `app/`,
 * `components/` and `lib/` and fails the build on a hand-written second copy
 * of any of them, and separately asserts this component maps the real lists.
 * The reason is not tidiness: the same sentences go in the email that
 * delivers the result, and a promise that drifts between the page and the
 * email is a promise we did not keep on a page somebody handed us a bid set
 * because of. Headings and connective prose are mine; claims are the
 * module's.
 *
 * ── THE LIMITS ARE SET IN THE SAME TYPE SIZE AS THE PROMISES ──
 *
 * Deliberate, and the point of the page rather than a legal footer. The
 * audience is a sub who will find out at bid time if we quietly returned four
 * rows off a scanned sheet; `lib/takeoff-offer.ts`'s own header makes the
 * argument. So "What we will not do" is `text-base`, exactly like every
 * deliverable body, and it sits ABOVE the form — read before anything is
 * handed over, not after.
 *
 * ── THE CLOSED STATE ──
 *
 * `open` is false when there is no address to receive a drawing set
 * (`lib/takeoff-offer-config.ts`). The form is then replaced outright: a form
 * that takes a contractor's name against a promise nothing can keep is worse
 * than a page that says it is shut, because they sit waiting for an email
 * that is waiting for them. The rest of the page stays readable, so somebody
 * who was handed the link still learns what the offer is.
 *
 * No fabricated logos, testimonials or customer counts — there are no
 * customers yet, and this audience spots an invented number instantly. Same
 * discipline as `app/pilot/page.tsx`, whose header states it at length.
 *
 * Static: no database read and no auth call, so it renders fast on a phone
 * off a link in a text message.
 */
export function WallTakeoffOffer({ open, sendTo }: { open: boolean; sendTo: string | null }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-6 sm:pt-12">
      {/* ---------------------------------------------------------- header */}
      <header className="flex flex-col items-start gap-6">
        <Image
          src="/brand/cstream-wordmark.png"
          alt="C Stream"
          width={240}
          height={48}
          className="h-8 w-auto sm:h-10"
          priority
        />
        <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl">
          Send us the set you are bidding this week. We will read it for free.
        </h1>
        <p className="text-base leading-relaxed text-ink-body sm:text-lg">
          You send the drawings. We send back what is in them &mdash; the sheets, the schedules and
          the gaps &mdash; normally {DELIVERY.turnaround}. No charge, no account, and nobody calls
          you before you have seen it.
        </p>
      </header>

      {/* ------------------------------------------------------ what you get
          Ordered as the module orders them: by how fast a contractor can tell
          the answer is right, not by how impressive it sounds. */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">What you get back</h2>
        <ul className="mt-5 flex flex-col gap-4">
          {DELIVERABLES.map((deliverable) => (
            <li
              key={deliverable.id}
              className="rounded-lg border border-line-card bg-surface p-4 sm:p-5"
            >
              <h3 className="text-lg font-semibold text-ink-label">{deliverable.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-ink-body">{deliverable.body}</p>
              {/* The `check` line is not a flourish. The whole offer rests on
                  a contractor being able to tell in ten seconds whether what
                  we sent is right — a number nobody can check is a number
                  nobody can trust, and that is worse than no number. */}
              <p className="mt-3 border-t border-line-row pt-3 text-base leading-relaxed text-ink-body">
                <span className="font-semibold text-brand">Check it in ten seconds:</span>{" "}
                {deliverable.check}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------- what we will not
          Same type size as the promises above. See the header. */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">What we will not do</h2>
        <p className="mt-2 text-base leading-relaxed text-ink-body">
          Written down in the same size as the rest of it, because the drawing set is the one thing
          you cannot un-send.
        </p>
        <ul className="mt-5 flex flex-col gap-3">
          {LIMITS.map((limit) => (
            <li key={limit} className="flex gap-3 text-base leading-relaxed text-ink-body">
              <span aria-hidden className="mt-0.5 shrink-0 text-brand">
                &#8212;
              </span>
              <span>{limit}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ----------------------------------------------------- how it works */}
      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">How it works</h2>
        <ol className="mt-5 flex flex-col gap-4">
          {NEXT_STEPS.map((step) => (
            <li key={step.step} className="flex gap-4">
              <span
                aria-hidden
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-neutral-900"
              >
                {step.step}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-ink-label">{step.title}</h3>
                <p className="mt-1 text-base leading-relaxed text-ink-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {/* The address, on screen, before anything is filled in — so the
            mechanism is visible rather than conditional on our email
            arriving. Only when there is one: see the closed state below. */}
        {sendTo && (
          <div className="mt-5">
            <p className="text-base leading-relaxed text-ink-body">The set goes to:</p>
            {/* Its own line rather than mid-sentence, so the tap target can
                clear 44px — an inline link inside a paragraph cannot. */}
            <a
              href={`mailto:${sendTo}`}
              className="inline-flex min-h-[44px] items-center break-all text-base font-semibold text-link hover:text-link-hover"
            >
              {sendTo}
            </a>
          </div>
        )}
        {/* DELIVERY.shareable belongs here: it is what the link in step 3 is
            good for, and it answers the question a contractor asks next —
            whether their estimator can use it too. */}
        <p className="mt-3 text-base leading-relaxed text-ink-body">{DELIVERY.shareable}</p>
      </section>

      {/* ------------------------------------------------------------- form */}
      <section className="mt-12">
        {open ? (
          <>
            <h2 className="text-2xl font-semibold text-ink">Where should we send it?</h2>
            <p className="mt-2 text-base leading-relaxed text-ink-body">
              Three fields are needed. The rest just helps us read the set faster.
            </p>
            <div className="mt-5">
              <TakeoffOfferForm />
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-line-card bg-surface p-5">
            <h2 className="text-2xl font-semibold text-ink">
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
    </main>
  );
}
