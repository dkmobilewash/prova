import Link from "next/link";

/**
 * THE PATTERN FOR STARTING A BID — read this before copying it anywhere
 * else, because the job page is getting the same treatment next and it
 * should look like a sibling of this, not a fresh invention.
 *
 * WHY A STEPPER, AND WHY THESE TWO STEPS. Every field a bid could ever
 * need used to live on one page, in the order features shipped in — GC
 * picker, then a scroll to the takeoff tool, then a scroll to line items,
 * then a scroll to catalog pricing. The founder's own complaint after
 * walking the product: "you have to scroll down super far and then keep
 * scrolling down... you should be able to see everything without having
 * to scroll. And then if you want to go into a piece of it, then you just
 * click into it." CREATING a bid and MANAGING one afterward are different
 * shapes: creation is a short, one-time path with a natural order (name
 * the job → put work on it), management is an open-ended set of sections
 * you dip into. This component is only the first shape. The job page stays
 * the second.
 *
 * THERE WAS A THIRD STEP — "Review" — AND IT IS GONE, 2026-09-21. It
 * collected nothing. Its own file said so: "there is nothing left this
 * step needs to collect that steps 1 and 2 didn't already save as it was
 * typed, so Finish is a plain link rather than a submit." What it rendered
 * was the job name, the GC and the line items, all of which the reader had
 * just typed on the two screens behind it, and every one of which the job
 * page itself shows — so it was a click that bought a second reading of
 * his own handwriting. A review step earns its place when it is the last
 * moment before something irreversible happens (money moves, paper goes to
 * the GC). Nothing happens at the end of this wizard: the job row was
 * written the instant step 1 submitted.
 *
 * The "Skip ahead — open this bid in full" link went with it, and for a
 * related reason: on the last step it now points where the primary button
 * points. Two controls, same destination, one of them whispering that the
 * wizard is something to escape from. `/jobs/new/[jobId]/review` still
 * resolves — it redirects to the job — so an open tab or a bookmark from
 * before this change lands somewhere real rather than on a 404.
 *
 * EACH STEP IS A REAL URL, not client-side wizard state: `/jobs/new`, then
 * `/jobs/new/[jobId]/items`. That is why step 1 has to exist before step 2
 * can — there is no job to key a URL on until `createJob` has actually
 * inserted one — and why this component takes `jobId` as an optional prop
 * rather than always linking every step: a step with nothing to point at
 * renders as plain text instead of a link, so a refresh or a bookmark of an
 * in-progress bid lands back on the exact step it was on, and the step that
 * needs a job simply cannot be reached before one exists.
 *
 * NOTHING IS EVER DISCARDED BY LEAVING. The job row is written to the
 * database the instant step 1 submits — a half-finished bid is a real
 * ESTIMATE-stage job sitting in the list, not a client-side draft that a
 * closed tab would lose.
 */
export function BidWizardSteps({
  current,
  jobId,
}: {
  current: 1 | 2;
  jobId?: string;
}) {
  const steps: { n: 1 | 2; label: string; href: string | null }[] = [
    { n: 1, label: "Job & GC", href: "/jobs/new" },
    { n: 2, label: "Add work", href: jobId ? `/jobs/new/${jobId}/items` : null },
  ];

  return (
    <nav aria-label="Start a bid" className="mb-6">
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
    </nav>
  );
}
