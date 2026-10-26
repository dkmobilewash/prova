import Link from "next/link";
import { money } from "@/lib/money";
import { guideStepLink } from "@/lib/bid/guide/stepHrefs";
import type { GuideStep, GuideStepStatus, JobGuide } from "@/lib/bid/guide/types";

/**
 * The left rail of a job's screen: where the bid stands, in five steps.
 *
 * ONE ELEMENT, TWO SHAPES. From `lg` it is the 300px column down the side the
 * founder picked (job name, the five steps with their summaries, the "Bid so
 * far" card). Below `lg` the same list becomes a five-across STEP STRIP at the
 * top of the page — status mark and a short label per step, each a 44px-tall
 * tap target — and the summaries fold into one line under it for the current
 * step, so a phone never scrolls sideways and the ask card is the next thing
 * under the thumb. Rendering it once (rather than a rail and a strip) means the
 * two can never disagree about a step's status.
 *
 * A STATUS IS A WORD AND A MARK, NEVER A COLOUR ALONE (CLAUDE.md, UI rules):
 * done has a check, current has a ring and `aria-current="step"`, and every
 * step carries its status in text for a screen reader.
 *
 * Done and current steps are links (`guideStepLink`); a step not reached yet is
 * plain text. Presentational: it takes a `JobGuide` and reads nothing else.
 */

const STATUS_WORD: Record<GuideStepStatus, string> = {
  done: "Done",
  current: "Current step",
  todo: "Not started",
};

function StepMark({ status }: { status: GuideStepStatus }) {
  const base = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold";
  if (status === "done") {
    return (
      <span aria-hidden="true" data-step-mark="done" className={`${base} border-tag-green-ink bg-tag-green text-tag-green-ink`}>
        ✓
      </span>
    );
  }
  if (status === "current") {
    return <span aria-hidden="true" data-step-mark="current" className={`${base} border-link`} />;
  }
  return <span aria-hidden="true" data-step-mark="todo" className={`${base} border-line-card`} />;
}

function StepBody({ step }: { step: GuideStep }) {
  const label = step.status === "todo" ? "text-ink-muted" : "text-ink";
  return (
    <>
      <StepMark status={step.status} />
      <span className="min-w-0">
        <span className={`block break-words text-xs font-semibold leading-tight lg:text-sm ${label}`}>
          {step.label}
          <span className="sr-only"> — {STATUS_WORD[step.status]}</span>
        </span>
        {step.summary ? (
          <span className="mt-0.5 hidden break-words text-xs text-ink-body lg:block">{step.summary}</span>
        ) : null}
      </span>
    </>
  );
}

export function JobGuideRail({ guide }: { guide: JobGuide }) {
  const current = guide.steps.find((step) => step.status === "current") ?? null;
  const meta = [guide.gcName, guide.dueLabel].filter(Boolean).join(" · ");
  const stepClass =
    "flex min-h-11 flex-col items-center gap-1 rounded-md px-0.5 py-1.5 text-center lg:flex-row lg:items-start lg:gap-3 lg:px-1 lg:text-left";

  return (
    <aside aria-label="This bid" data-guide="rail" className="min-w-0 print:hidden lg:sticky lg:top-4 lg:self-start">
      <p className="text-sm">
        <Link href="/bid/bids" className="inline-flex min-h-11 items-center text-link hover:underline">
          ← All bids
        </Link>
      </p>
      <h1 className="break-words font-headline text-xl font-semibold text-ink lg:text-lg" data-guide="job-name">
        {guide.name}
      </h1>
      {meta ? <p className="break-words text-sm text-ink-body">{meta}</p> : null}
      {guide.bidSoFar != null ? (
        <p className="mt-1 text-sm text-ink-body lg:hidden" data-guide="bid-so-far-inline">
          Bid so far <span className="font-semibold tabular-nums text-ink">{money(guide.bidSoFar)}</span>
        </p>
      ) : null}

      <ol className="mt-3 grid grid-cols-5 gap-1 lg:mt-5 lg:grid-cols-1 lg:gap-0" data-guide="steps">
        {guide.steps.map((step, index) => {
          const href = guideStepLink(guide.jobId, step);
          const last = index === guide.steps.length - 1;
          return (
            <li key={step.key} className="relative lg:pb-3" data-step={step.key} data-status={step.status}>
              {!last ? (
                <span aria-hidden="true" className="absolute bottom-0 left-[16px] top-9 hidden w-px bg-line-card lg:block" />
              ) : null}
              {href ? (
                <Link
                  href={href}
                  aria-current={step.status === "current" ? "step" : undefined}
                  className={`${stepClass} hover:bg-rail-hover`}
                >
                  <StepBody step={step} />
                </Link>
              ) : (
                <div className={stepClass}>
                  <StepBody step={step} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {current ? (
        <p className="mt-2 break-words text-sm text-ink-body lg:hidden" data-guide="current-line">
          <span className="font-semibold text-ink">{current.label}</span>
          {current.summary ? <> · {current.summary}</> : null}
        </p>
      ) : null}

      {guide.bidSoFar != null ? (
        <div
          className="mt-4 hidden rounded-lg border border-line-card bg-surface p-4 lg:block"
          data-guide="bid-so-far"
        >
          <p className="text-xs text-ink-muted">Bid so far</p>
          <p className="text-2xl font-semibold tabular-nums text-ink">{money(guide.bidSoFar)}</p>
        </div>
      ) : null}
    </aside>
  );
}
