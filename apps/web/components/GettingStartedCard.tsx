import Link from "next/link";
import type { GettingStartedChecklist } from "@/lib/getting-started";
import { HideGettingStartedButton } from "@/components/HideGettingStartedButton";
import { StartFullTourButton } from "@/components/StartFullTourButton";

/**
 * The first thing a brand-new account sees on /dashboard: what to do
 * first, in order, with each step ticked from real data.
 *
 * A server component. It renders whatever `gettingStartedChecklist` hands
 * it and decides nothing itself — the page decides whether it renders at
 * all (hidden by cookie, or nothing required left), so there is one place
 * that rule lives.
 */
export function GettingStartedCard({ checklist }: { checklist: GettingStartedChecklist }) {
  const { steps, requiredDone, requiredTotal } = checklist;

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="rounded-lg border border-line-card bg-surface p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="getting-started-heading" className="text-base font-semibold text-ink">
            Getting started
          </h2>
          <p className="mt-1 text-sm text-ink-body">
            A few things to set up so C Stream is working for you.{" "}
            <span className="font-medium text-ink">
              {requiredDone} of {requiredTotal} done.
            </span>
          </p>
          <p className="text-sm text-ink-body">
            New here? <StartFullTourButton>Take the 3-minute tour</StartFullTourButton>
          </p>
        </div>
        <HideGettingStartedButton />
      </div>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-line-row"
        role="progressbar"
        aria-label="Getting started progress"
        aria-valuemin={0}
        aria-valuemax={requiredTotal}
        aria-valuenow={requiredDone}
      >
        <div
          className="h-full rounded-full bg-bar-green"
          style={{ width: `${requiredTotal === 0 ? 0 : Math.round((requiredDone / requiredTotal) * 100)}%` }}
        />
      </div>

      <ol className="mt-4 divide-y divide-line-row">
        {steps.map((step) => (
          <li key={step.id} data-step={step.id} data-done={step.done ? "true" : "false"} className="flex gap-3 py-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                step.done
                  ? "border-transparent bg-brand text-neutral-900"
                  : "border-line-card text-ink-muted"
              }`}
            >
              {step.done ? "✓" : ""}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${step.done ? "text-ink-body" : "text-ink"}`}>
                {step.title}
                {step.optional && <span className="ml-2 text-xs font-normal text-ink-muted">Optional</span>}
                <span className="sr-only">{step.done ? " (done)" : " (not done yet)"}</span>
              </p>
              {step.done ? (
                step.doneBody && <p className="mt-0.5 text-sm text-ink-body">{step.doneBody}</p>
              ) : (
                <>
                  <p className="mt-0.5 text-sm text-ink-body">{step.body}</p>
                  <Link
                    href={step.href}
                    className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-hover hover:underline"
                  >
                    {step.linkLabel}
                  </Link>
                  {step.ask && (
                    /* "the assistant" is a second name for the thing the nav
                       rail calls "Ask C Stream" — two names for one feature,
                       and the unfamiliar one was on the card a brand-new
                       owner reads first. The nav's name wins: it is the one
                       he can find again. */
                    <p className="text-sm text-ink-body">
                      Or just say it in one sentence, like{" "}
                      <span className="text-ink">&ldquo;{step.ask.example}&rdquo;</span>.{" "}
                      <Link
                        href={step.ask.href}
                        className="inline-flex min-h-11 items-center font-medium text-link hover:text-link-hover hover:underline"
                      >
                        Ask C Stream
                      </Link>
                    </p>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
