import Link from "next/link";
import type { JobNext, JobStep } from "@/lib/job-steps";

/**
 * ── THE ESTIMATING STEPS, AS ONE SLIM BAR ──
 *
 * Job → Plans → Scale → Takeoff → Review → Estimate → Send, under the job's
 * stage boxes while the job is an estimate. Each step says done, current or
 * not started, by a word as well as a mark (a colour is never the whole of a
 * status), and every step is a link: a person can go to any of them, in any
 * order. Takeoff and Review open the full-screen workspace in its own tab,
 * like the Takeoff button. The current step gets the one "Next: …" button.
 *
 * On a phone the steps scroll sideways in their own row and Next takes the
 * line under them at full width, so it is never squeezed out by the steps.
 *
 * A server component: nothing here changes without a navigation, and the
 * facts are `jobSteps()`'s, so this only draws them.
 */
const STATE_WORD = { done: "done", current: "current step", todo: "not started" } as const;

export function JobStepper({ steps, next }: { steps: JobStep[]; next: JobNext }) {
  return (
    <nav
      aria-label="Estimating steps"
      data-job-stepper=""
      className="mb-3 flex items-center gap-3 max-sm:flex-wrap max-sm:gap-1.5 rounded-lg border border-line-card bg-surface px-2 py-1.5 print:hidden"
    >
      {/* `relative`: each step's screen-reader word is `sr-only`, which is
          position: absolute — without a positioned row to belong to it escaped
          this row's sideways scroll and widened the whole page by 260px on a
          phone (job-stepper.spec.ts, step 6). */}
      <ol className="relative flex min-w-0 flex-1 max-sm:basis-full items-center gap-0.5 overflow-x-auto max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]">
        {steps.map((step, i) => (
          <li key={step.key} className="flex shrink-0 items-center">
            {i > 0 && (
              <span aria-hidden="true" className="px-0.5 text-ink-muted">
                ›
              </span>
            )}
            <Link
              href={step.href}
              target={step.newTab ? "_blank" : undefined}
              rel={step.newTab ? "noopener" : undefined}
              data-job-step={step.key}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              title={`${step.label}: ${STATE_WORD[step.state]}${step.newTab ? " (opens the takeoff in a new tab)" : ""}`}
              className={`flex min-h-[32px] items-center gap-1.5 rounded-md px-2 text-sm hover:bg-rail-hover ${
                step.state === "current" ? "font-semibold text-ink" : step.state === "done" ? "text-ink-body" : "text-ink-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${
                  step.state === "current"
                    ? "border-brand bg-brand text-neutral-900"
                    : step.state === "done"
                      ? "border-rail-hover bg-rail-hover text-ok"
                      : "border-line-card text-ink-muted"
                }`}
              >
                {step.state === "done" ? "✓" : i + 1}
              </span>
              {step.label}
              {step.newTab && <span aria-hidden="true">↗</span>}
              <span className="sr-only">, {STATE_WORD[step.state]}</span>
            </Link>
          </li>
        ))}
      </ol>
      {next !== null && (
        <Link
          href={next.href}
          target={next.newTab ? "_blank" : undefined}
          rel={next.newTab ? "noopener" : undefined}
          data-job-next=""
          className="inline-flex min-h-[32px] shrink-0 items-center max-sm:w-full max-sm:justify-center rounded-md bg-brand px-3 text-sm font-semibold text-neutral-900 hover:opacity-90"
        >
          Next: {next.label}
          {next.newTab && <span aria-hidden="true">&nbsp;↗</span>}
        </Link>
      )}
    </nav>
  );
}
