import Image from "next/image";
import { Reveal } from "@/components/Reveal";
import { WaiverPickFigure } from "@/components/landing/WaiverPickFigure";
import {
  WAIVER_LAUNCH_STATES,
  WAIVER_LIMITS,
  WAIVER_OUTCOMES,
  WAIVER_TYPES_COPY,
} from "@/lib/lien-waiver-offer";

/**
 * `/lien-waiver` — the landing page for the free lien waiver generator.
 *
 * THIS IS THE PAGE ONLY. The generator is Diego's: the statutory forms, the
 * field matrix, the PDF renderer and the exceptions interview all live
 * behind the call to action, not in here. If this file ever grows a form
 * field or a line of statutory text, the lane has been crossed.
 *
 * ── THE SHAPE, WHICH IS D'S AND WAS ALREADY APPROVED ──
 *
 * Headline, then a picture that explains the thing, then three outcomes,
 * then the ask, then the limits. The founder's rule from the page this
 * replaced: a sub should know what this is by LOOKING at it, not by reading
 * four hundred words. So the figure carries the argument and the words are
 * footnotes.
 *
 * ── WHY THE PICKER IS THE PICTURE ──
 *
 * The four waiver types are not equally safe. Conditional before the money
 * clears, unconditional after; signing unconditional on a promise gives up
 * the lien right with nothing received for it. That is the mistake this
 * whole product exists to prevent, so the CHOICE is the visible half of the
 * figure and the filled form follows from it. A page that lists four names
 * without saying which one is dangerous has taught nobody anything.
 *
 * ── WHAT THIS PAGE MUST NEVER DO ──
 *
 * Reproduce statutory language, quote a form, or tell anyone which waiver to
 * sign. The limits are rendered at the same size as the promises, which is
 * the convention the previous offer page set and the one most likely to be
 * quietly broken by a redesign: an offer whose caveats are smaller than its
 * claims expects not to be read carefully, and this one goes to a person
 * whose lien rights are the subject.
 */
export function LienWaiverOffer({ startHref }: { startHref: string }) {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      {/* No <Reveal> above the fold — content that fades in on load reads as
          lag rather than polish, the same rule the main landing page holds. */}
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
          Your state&rsquo;s lien waiver,
          <br />
          filled in and ready to sign.
        </h1>
        <p className="text-lg leading-relaxed text-ink-body sm:text-xl">
          Free, no account, about three minutes.
        </p>
      </header>

      <WaiverPickFigure />

      {/* The outcomes — bold lead, muted tail, scanned rather than read. */}
      <section className="mt-12 border-t border-line-row pt-7 sm:mt-14">
        <h2 className="sr-only">What it gets you</h2>
        <ul className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          {WAIVER_OUTCOMES.map((outcome) => (
            <li key={outcome.lead} className="flex min-w-0 flex-1 gap-2.5 text-sm leading-relaxed">
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

      {/* The ask. A link rather than a form: the intake belongs to the tool,
          and a form here would be a second front door that could disagree
          with it about which state and type the sub is in. */}
      <section className="mt-12 sm:mt-14">
        <a
          href={startHref}
          className="inline-flex items-center justify-center rounded-md bg-brand px-8 py-4 text-lg font-semibold text-neutral-900 transition-colors duration-[var(--speed-fast)] ease-[var(--ease-landing-snap)] hover:bg-yellow-500"
        >
          Make my waiver
        </a>
        <p className="mt-4 text-sm text-ink-body">
          {WAIVER_LAUNCH_STATES.join(", ")} today. More states as we verify their forms.
        </p>
      </section>

      {/* The four types, under the ask, for the reader who wants to know
          which one they are before they start. */}
      <Reveal className="mt-16 border-t border-line-card pt-10 sm:mt-20">
        <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
          The four, and when each one is right
        </h2>
        <ul className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {WAIVER_TYPES_COPY.map((type) => (
            <li key={type.key} className="min-w-0">
              <p className="text-sm font-semibold text-ink-label">{type.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-body">{type.when}</p>
              <p
                className={`mt-1.5 text-xs leading-relaxed ${
                  type.safeDefault ? "text-tag-green-ink" : "text-tag-amber-ink"
                }`}
              >
                {type.risk}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>

      {/* The limits, at the promises' own size. See the header. */}
      <Reveal className="mt-12">
        <h2 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">
          What we do not do
        </h2>
        <ul className="mt-5 flex flex-col gap-3">
          {WAIVER_LIMITS.map((limit) => (
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
