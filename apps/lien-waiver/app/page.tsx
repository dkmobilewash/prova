import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { NEW_MEXICO, STATE_CONTENT } from "@/lib/content";
import { CSTREAM_URL } from "@/lib/site";
import { isPublished } from "@/lib/statutes/review";
import { STATES } from "@/lib/statutes/types";

/**
 * The landing page. Lists only the states this deployment may show -- in
 * production that is the ones an attorney has reviewed (lib/statutes/
 * review.ts) -- plus New Mexico, which has no statutory form and says so.
 */
export default function Home() {
  const states = STATES.filter((state) => isPublished(state));
  return (
    <>
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-quiet">Free. No account.</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-ink sm:text-4xl">
          Your state&apos;s statutory lien waiver, filled out on your phone.
        </h1>
        <p className="mt-4 text-lg text-quiet">
          Pick your state, answer two questions, fill in the blanks, and download a clean PDF to hand the GC. The form
          text is copied from the state&apos;s own code, not rewritten.
        </p>

        <h2 className="mt-10 text-xl font-bold text-ink">Pick your state</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {states.map((state) => (
            <li key={state}>
              <Link
                href={`/${STATE_CONTENT[state].slug}`}
                className="flex min-h-primary items-center justify-between rounded-lg border-2 border-ink bg-paper px-4 py-3 text-lg font-semibold text-ink hover:bg-brand"
              >
                <span>{STATE_CONTENT[state].name}</span>
                <span className="text-sm font-normal text-quiet">{STATE_CONTENT[state].statute}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={`/${NEW_MEXICO.slug}`}
              className="flex min-h-primary items-center justify-between rounded-lg border-2 border-line bg-paper px-4 py-3 text-lg font-semibold text-ink hover:border-ink"
            >
              <span>{NEW_MEXICO.name}</span>
              <span className="text-sm font-normal text-quiet">No statutory form</span>
            </Link>
          </li>
        </ul>
        {states.length === 0 ? (
          <p className="mt-4 rounded-lg bg-warn-ground p-4 text-warn">
            The state forms are with a construction attorney for review and will be back shortly.
          </p>
        ) : null}

        <h2 className="mt-12 text-xl font-bold text-ink">How it works</h2>
        <ol className="mt-4 space-y-3 text-quiet">
          <li>
            <strong className="text-ink">1. Two questions pick the form.</strong> Is this a progress payment or the
            final one? Has the money cleared your bank yet?
          </li>
          <li>
            <strong className="text-ink">2. Fill in the blanks.</strong> Project, GC, owner, amount, through date. Your
            details are saved in this browser for next pay period.
          </li>
          <li>
            <strong className="text-ink">3. Check it and download.</strong> You see the whole form before you download
            it. We email you the PDF too.
          </li>
        </ol>

        <h2 className="mt-12 text-xl font-bold text-ink">What this is not</h2>
        <p className="mt-3 text-quiet">
          It does not tell you whether to sign. It does not work out deadlines. It prints the form your state&apos;s
          statute sets out, with what you typed in the blanks. What you give up by signing is in the form&apos;s own
          words, and you should read them.
        </p>

        <div className="mt-12 rounded-lg border-2 border-ink bg-paper p-5">
          <h2 className="text-lg font-bold text-ink">Run commercial framing, drywall or EIFS?</h2>
          <p className="mt-2 text-quiet">
            Send us the bid and final costs from one finished job. In 48 hours we&apos;ll show you where it made or lost
            money, phase by phase. Free, nothing to learn.
          </p>
          <a
            href={CSTREAM_URL}
            className="mt-4 inline-flex min-h-touch items-center rounded-md bg-brand px-5 font-semibold text-ink hover:bg-brand-hover"
          >
            Get a free job breakdown
          </a>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
