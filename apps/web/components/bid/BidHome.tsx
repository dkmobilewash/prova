import Link from "next/link";
import type { GuideTone, JobGuide, GuideStepStatus } from "@/lib/bid/guide/types";
import { TONE_LABEL, askButtonLabel, dueLine, needsYou, progressLabel, progressSegments } from "@/lib/bid/guide/homeView";
import { BidHomeAsk } from "@/components/bid/BidHomeAsk";

/**
 * C Stream Bid's home — one box, and your bids down the side.
 *
 * Draws `JobGuide`s and nothing else (`lib/bid/guide/types.ts`): every sentence
 * on a bid or a "Needs you" row was written by the guide engine from the job's
 * own rows, so this screen and the job's own screen cannot disagree about where
 * a job stands, and no figure here comes from a model.
 *
 * LAYOUT. Desktop: the bids list on the left, the box and "Needs you" in the
 * middle. Phone: the box first and the list below it — the DOM order IS the
 * phone order (the box is the thing to reach for), and the list is lifted to
 * the left from `lg` up.
 *
 * LINKS. Every bid and every "Needs you" button goes to the job,
 * `/bid/estimates/<id>`; the job's own screen is where the ask is answered. The
 * chips are only what does something real today: the bid log's due view.
 */

const SEGMENT: Record<GuideStepStatus, string> = {
  done: "bg-tag-green-ink",
  current: "bg-tag-brand",
  todo: "bg-line-row",
};

/** The pill: a word on a tinted ground. */
const PILL: Record<GuideTone, string> = {
  question: "bg-tag-amber text-tag-amber-ink",
  ready: "bg-tag-green text-tag-green-ink",
  update: "bg-tag-brand-soft text-tag-brand-soft-ink",
  working: "bg-tag-slate text-tag-slate-ink",
  blocked: "bg-tag-rose text-tag-rose-ink",
};

/** The one-line status, coloured by tone. Text colours are the tag INK tokens,
 * which carry the contrast on `canvas` in both themes. */
const LINE: Record<GuideTone, string> = {
  question: "text-tag-amber-ink",
  ready: "text-tag-green-ink",
  update: "text-tag-brand-soft-ink",
  working: "text-ink-body",
  blocked: "text-tag-rose-ink",
};

function ProgressBar({ guide }: { guide: JobGuide }) {
  return (
    <div role="img" aria-label={progressLabel(guide)} className="mt-2 flex gap-1" data-bid="progress">
      {progressSegments(guide).map((status, index) => (
        <span key={index} className={`h-1.5 flex-1 rounded-full ${SEGMENT[status]}`} data-status={status} />
      ))}
    </div>
  );
}

function BidRow({ guide }: { guide: JobGuide }) {
  const due = dueLine(guide);
  return (
    <li>
      <Link
        href={`/bid/estimates/${guide.jobId}`}
        className="block min-h-11 rounded-lg px-3 py-3 hover:bg-rail-hover"
        data-bid="home-bid"
      >
        <span className="block break-words text-base font-semibold text-ink">{guide.name}</span>
        {due && <span className="mt-0.5 block text-sm text-ink-muted">{due}</span>}
        <ProgressBar guide={guide} />
        <span className={`mt-2 block text-sm ${LINE[guide.tone]}`} data-tone={guide.tone}>
          {guide.oneLine}
        </span>
      </Link>
    </li>
  );
}

function NeedsYouRow({ guide }: { guide: JobGuide }) {
  return (
    <li
      className="flex flex-col gap-3 border-b border-line-row py-4 sm:flex-row sm:items-center sm:justify-between"
      data-bid="home-needs"
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <span
          className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[guide.tone]}`}
          data-tone={guide.tone}
        >
          {TONE_LABEL[guide.tone]}
        </span>
        <span className="break-words text-base font-semibold text-ink">{guide.name}</span>
        <span className="break-words text-sm text-ink-body">{guide.oneLine}</span>
      </div>
      <Link
        href={`/bid/estimates/${guide.jobId}`}
        className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-md border border-line-card px-4 text-sm font-medium text-ink hover:bg-rail-hover"
      >
        {askButtonLabel(guide)}
      </Link>
    </li>
  );
}

export function BidHome({ guides, gcs }: { guides: JobGuide[]; gcs: { id: string; name: string }[] }) {
  const asks = needsYou(guides);
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0 lg:order-2 lg:max-w-3xl">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-neutral-900"
            aria-hidden="true"
          >
            AI
          </span>
          <h1 className="font-headline text-2xl font-semibold text-ink sm:text-3xl">What are we bidding today?</h1>
        </div>

        <div className="mt-5">
          <BidHomeAsk gcs={gcs} />
        </div>

        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Quick questions" data-bid="home-chips">
          <li>
            <Link
              href="/bid/bids?view=due"
              className="inline-flex min-h-11 items-center rounded-full border border-line-card px-4 text-sm text-ink hover:bg-rail-hover"
            >
              What&rsquo;s due this week?
            </Link>
          </li>
        </ul>

        <section className="mt-10" aria-labelledby="needs-you" data-bid="home-needs-list">
          <h2 id="needs-you" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Needs you
          </h2>
          {asks.length === 0 ? (
            <p className="mt-3 text-sm text-ink-body" data-bid="home-needs-empty">
              {guides.length === 0
                ? "Nothing yet. Paste an invite or attach drawings above and your bids show up here."
                : "Nothing needs you right now."}
            </p>
          ) : (
            <ul className="mt-2">
              {asks.map((guide) => (
                <NeedsYouRow key={guide.jobId} guide={guide} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="min-w-0 lg:order-1" aria-labelledby="your-bids" data-bid="home-bids">
        <h2 id="your-bids" className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Your bids &middot; {guides.length} open
        </h2>
        {guides.length === 0 ? (
          <p className="mt-3 px-3 text-sm text-ink-body" data-bid="home-bids-empty">
            No open bids yet.{" "}
            <Link href="/bid/bids?view=all" className="inline-flex min-h-11 items-center text-link hover:underline">
              See your bid log
            </Link>
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {guides.map((guide) => (
              <BidRow key={guide.jobId} guide={guide} />
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
