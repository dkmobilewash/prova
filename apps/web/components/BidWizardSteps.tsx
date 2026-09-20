import Link from "next/link";

/**
 * THE PATTERN FOR STARTING A BID — read this before copying it anywhere
 * else, because the job page is getting the same treatment next and it
 * should look like a sibling of this, not a fresh invention.
 *
 * WHY A STEPPER, AND WHY THESE THREE STEPS. Every field a bid could ever
 * need used to live on one page, in the order features shipped in — GC
 * picker, then a scroll to the takeoff tool, then a scroll to line items,
 * then a scroll to catalog pricing. The founder's own complaint after
 * walking the product: "you have to scroll down super far and then keep
 * scrolling down... you should be able to see everything without having
 * to scroll. And then if you want to go into a piece of it, then you just
 * click into it." CREATING a bid and MANAGING one afterward are different
 * shapes: creation is a short, one-time path with a natural order (name
 * the job → put work on it → check it over), management is an
 * open-ended set of sections you dip into. This component is only the
 * first shape. The job page — out of scope here, on purpose, because two
 * other agents are inside it right now — stays the second.
 *
 * EACH STEP IS A REAL URL, not client-side wizard state. `/jobs/new`,
 * then `/jobs/new/[jobId]/items`, then `/jobs/new/[jobId]/review`. That is
 * why step 1 has to exist before steps 2 and 3 can — there is no job to
 * key a URL on until `createJob` has actually inserted one — and why this
 * component takes `jobId` as an optional prop rather than always linking
 * every step: a step with nothing to point at renders as plain text
 * instead of a link, so a refresh or a bookmark of an in-progress bid
 * lands back on the exact step it was on, and the two steps that need a
 * job simply cannot be reached before one exists.
 *
 * NOTHING IS EVER DISCARDED BY LEAVING. The job row is written to the
 * database the instant step 1 submits — a half-finished bid is a real
 * ESTIMATE-stage job sitting in the list, not a client-side draft that a
 * closed tab would lose. "Open this bid in full" always works, and always
 * goes to the one place every started bid can be finished, priced and
 * eventually contracted whether or not the wizard was ever completed.
 */
export function BidWizardSteps({
  current,
  jobId,
}: {
  current: 1 | 2 | 3;
  jobId?: string;
}) {
  const steps: { n: 1 | 2 | 3; label: string; href: string | null }[] = [
    { n: 1, label: "Job & GC", href: "/jobs/new" },
    { n: 2, label: "Add work", href: jobId ? `/jobs/new/${jobId}/items` : null },
    { n: 3, label: "Review", href: jobId ? `/jobs/new/${jobId}/review` : null },
  ];

  return (
    <nav aria-label="Start a bid" className="mb-6 flex flex-col gap-3">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((step, index) => {
          const isCurrent = step.n === current;
          const isDone = step.n < current;
          const chip = (
            <span
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${
                isCurrent
                  ? "border-brand bg-brand/10 font-medium text-ink"
                  : isDone
                    ? "border-line-card text-ink-label"
                    : "border-line-card text-ink-muted"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  isCurrent ? "bg-brand text-neutral-900" : isDone ? "bg-neutral-700 text-ink" : "bg-neutral-800 text-ink-muted"
                }`}
              >
                {isDone ? "✓" : step.n}
              </span>
              {step.label}
            </span>
          );
          return (
            <li key={step.n} className="flex items-center gap-2">
              {step.href && !isCurrent ? (
                <Link href={step.href} className="hover:opacity-80">
                  {chip}
                </Link>
              ) : (
                chip
              )}
              {index < steps.length - 1 && <span className="text-ink-muted">→</span>}
            </li>
          );
        })}
      </ol>

      {jobId && (
        <Link href={`/jobs/${jobId}`} className="self-start text-xs text-link hover:underline">
          Skip ahead — open this bid in full →
        </Link>
      )}
    </nav>
  );
}
