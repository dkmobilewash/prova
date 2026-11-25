"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Spinner } from "@/components/Spinner";
import { deleteTakeoffPlan, previewDeleteTakeoffPlan } from "@/lib/actions";
import type { PlanDeleteImpact } from "@/lib/takeoff/planDelete";
import { planDeletedToast, planDeleteWords } from "@/lib/takeoff/planDeleteWords";

const TOAST_EVENT = "prova:plan-deleted";

/**
 * ── DELETE A PLAN, SEEING FIRST WHAT IT DOES TO THE ESTIMATE (Diego, 2026-11-25) ──
 *
 * The first press asks the server what the delete would do (`previewDeleteTakeoffPlan` runs the delete itself and
 * rolls it back), then opens a modal with those numbers: one primary button and Cancel. A native <dialog> opened with
 * showModal(): focus moves in, Tab stays inside, Escape cancels, the page behind is inert, and focus returns to this
 * button on close. The toast is raised on the page (`PlanDeletedToast`), because this button goes with its plan.
 */
export function DeletePlanButton({ jobId, planId }: { jobId: string; planId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [impact, setImpact] = useState<PlanDeleteImpact | null>(null);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const words = impact === null ? null : planDeleteWords(impact, keep);

  const open = () =>
    start(async () => {
      setError(null);
      const shown = await previewDeleteTakeoffPlan(jobId, planId);
      if (!shown.ok) return setError(shown.error);
      setKeep(true);
      setImpact(shown.value);
      dialog.current?.showModal();
    });

  const confirm = () =>
    start(async () => {
      const done = await deleteTakeoffPlan(jobId, planId, { keepHandPriced: keep });
      if (!done.ok) return setError(done.error);
      dialog.current?.close();
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: planDeletedToast(done.value) }));
    });

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        title="Shows what deleting this plan does to the estimate before anything is deleted."
        data-takeoff="delete-plan"
        className="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:border-red-500 hover:text-danger disabled:opacity-50"
      >
        {pending && impact === null ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Checking…
          </span>
        ) : (
          "Delete plan"
        )}
      </button>
      {error !== null && impact === null && <p role="alert" className="text-xs text-danger">{error}</p>}
      <dialog
        ref={dialog}
        aria-labelledby={`delete-plan-title-${planId}`}
        onClose={() => setImpact(null)}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line-card bg-surface p-5 text-left text-sm text-ink-body backdrop:bg-black/60"
      >
        {words !== null && (
          <div className="flex flex-col gap-3">
            <h2 id={`delete-plan-title-${planId}`} className="text-base font-semibold text-ink">
              {words.title}
            </h2>
            {words.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {words.keepLabel !== null && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
                <span>{words.keepLabel}</span>
              </label>
            )}
            {words.warning !== null && (
              <p role="note" className="rounded-md border border-amber-500/60 px-3 py-2 text-ink-body">
                {words.warning}
              </p>
            )}
            {error !== null && <p role="alert" className="text-danger">{error}</p>}
            <div className="mt-1 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => dialog.current?.close()} className="rounded-md border border-line-card px-3 py-1.5 text-ink-label hover:bg-rail">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                data-takeoff="delete-plan-confirm"
                className="rounded-md border border-red-500 px-3 py-1.5 font-medium text-danger hover:bg-tag-rose disabled:opacity-50"
              >
                {pending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Deleting…
                  </span>
                ) : (
                  words.primary
                )}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

/** The plan-delete toast, mounted on the page so it outlives the plan block the delete removes. */
export function PlanDeletedToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const show = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener(TOAST_EVENT, show);
    return () => window.removeEventListener(TOAST_EVENT, show);
  }, []);
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return message === null ? null : (
    <div role="status" data-takeoff="plan-deleted-toast" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line-card bg-surface px-3 py-1.5 text-xs text-ink-body shadow-lg">
      {message}
    </div>
  );
}
