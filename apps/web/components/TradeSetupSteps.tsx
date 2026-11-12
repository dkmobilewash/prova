"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyTradePreset, createSampleJob, saveStarterMarkup, skipBusinessScopeQuestions } from "@/lib/actions";
import { CompanySetupGate } from "@/components/CompanySetupGate";
import { PlanReadingSwitch } from "@/components/PlanReadingSwitch";
import { Spinner } from "@/components/Spinner";
import { RECAP_RATE_FIELDS } from "@/lib/bid-recap";
import { MARKUP_FIELDS, TRADE_PRESETS } from "@/lib/trade-presets";
import { DOOR_SCOPE_LABELS, DOOR_SCOPES, type DoorScope } from "@/lib/estimating/doorLines";

export type SetupStep = "trade" | "sample" | "markup" | "questions";

/**
 * `/welcome`, guided flow Phase 5: the trade in one tap, then the company's own
 * markup, then the three questions `CompanySetupGate` has always asked (which
 * finish onboarding). The page picks the starting step from what is stored, so
 * a reload resumes rather than re-asks.
 *
 * The markup boxes are EMPTY and stay empty until the person types: Diego,
 * 2026-11-05, never a pre-filled figure. Text inputs with a decimal keypad,
 * not `type="number"`, which submits an empty string for a value the browser
 * dislikes (CLAUDE.md, the openings-deduction entry).
 */
export function TradeSetupSteps({ initial, planReadingOn }: { initial: SetupStep; planReadingOn: boolean }) {
  const [step, setStep] = useState<SetupStep>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [doorScope, setDoorScope] = useState<DoorScope>("BY_OTHERS");
  const router = useRouter();

  if (step === "questions") return <CompanySetupGate />;

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, next: SetupStep) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(result.error ?? "Couldn't save just now. Try again.");
          return;
        }
        setStep(next);
      } catch {
        setError("Couldn't save just now. Nothing was changed — try again.");
      }
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-line-card bg-surface p-8">
        {step === "trade" ? (
          <>
            <h1 className="text-xl font-semibold text-ink">What&apos;s your trade?</h1>
            <p className="mt-2 text-sm text-ink-body">
              We&apos;ll start you with that trade&apos;s wall types, takeoff tools and estimate lines. No prices — those are yours.
            </p>
            {/* The same choice as Settings' "Doors and frames", asked before the tap so the trade's
                setup carries it; by others unless changed, as every preset starts. */}
            <fieldset className="mt-5" data-setup="door-scope">
              <legend className="text-sm font-medium text-ink">Doors and frames</legend>
              <div className="mt-1 flex flex-col gap-1">
                {DOOR_SCOPES.map((scope) => (
                  <label key={scope} className="flex min-h-11 items-center gap-2 text-sm text-ink-body">
                    <input type="radio" name="doorScope" value={scope} checked={doorScope === scope} onChange={() => setDoorScope(scope)} className="h-4 w-4 shrink-0" />
                    {DOOR_SCOPE_LABELS[scope]}
                  </label>
                ))}
              </div>
            </fieldset>
            <ul className="mt-6 flex flex-col gap-2" data-setup="trades">
              {TRADE_PRESETS.map((preset) => (
                <li key={preset.choice}>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => applyTradePreset(preset.choice, doorScope), "sample")}
                    className="flex min-h-12 w-full items-center rounded-md border border-line-card px-4 text-left text-sm font-medium text-ink hover:border-link hover:text-link disabled:opacity-50"
                  >
                    {preset.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-ink-muted">You can change any of it later in Settings and on the Wall types page.</p>
            <PlanReadingSwitch initialOn={planReadingOn} />
            {/* Today's skip, unchanged: onboarding done, nothing preset, no
                markup owed. Never a dead end (CompanySetupGate's own rule). */}
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await skipBusinessScopeQuestions();
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.replace("/dashboard");
                  } catch {
                    setError("Couldn't save just now. Nothing was changed — try again.");
                  }
                });
              }}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
          </>
        ) : step === "sample" ? (
          /* ── SEE IT WORK BEFORE YOUR OWN PLANS ── a sample job on an invented
             drawing, built by the same steps a real one goes through
             (`lib/sample-job`). Not now carries on exactly as before. */
          <div data-setup="sample">
            <h1 className="text-xl font-semibold text-ink">See it work first?</h1>
            <p className="mt-2 text-sm text-ink-body">
              Try it on a sample set: an invented office floor plan with the scale set, the walls found, a few left for you to
              confirm and an estimate started. About two minutes, before you upload your own plans.
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              It is marked Sample, it never uses your plan sheets, and you can delete it in one press.
            </p>
            <button
              type="button"
              disabled={isPending}
              data-setup="try-sample"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await createSampleJob();
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.push(`/jobs/${result.value.jobId}`);
                  } catch {
                    setError("Couldn't make the sample just now. Try again, or carry on without it.");
                  }
                });
              }}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 disabled:opacity-50"
            >
              {isPending && <Spinner />}
              {isPending ? "Making the sample…" : "Try it on a sample set"}
            </button>
            <button
              type="button"
              disabled={isPending}
              data-setup="skip-sample"
              onClick={() => setStep("markup")}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover hover:text-ink disabled:opacity-50"
            >
              Not now
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              run(() => saveStarterMarkup(formData), "questions");
            }}
          >
            <h1 className="text-xl font-semibold text-ink">Your markup</h1>
            <p className="mt-2 text-sm text-ink-body">
              Your own figures, as percentages. Every estimate starts from these, and you can change them in Settings.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4">
              {MARKUP_FIELDS.map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm text-ink-body">
                  {RECAP_RATE_FIELDS[field].label}
                  <span className="flex items-center gap-1">
                    <input
                      name={field}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      className="min-h-11 w-full rounded-md border border-line-card bg-canvas px-3 text-ink"
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </label>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-4 rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="mt-8 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep("questions")}
                disabled={isPending}
                className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover hover:text-ink disabled:opacity-50"
              >
                Later
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Saving…
                  </span>
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </form>
        )}
        {(step === "trade" || step === "sample") && error && (
          <p role="alert" className="mt-4 rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
