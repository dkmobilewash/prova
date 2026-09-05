"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordExecutedSubcontract } from "@/lib/actions";

const field =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

/**
 * The second route to an executed contract: the GC issued the subcontract,
 * signed it, and sent it back — on paper, or through the GC's own system.
 *
 * Collapsed behind a button, like every other add-form in this app, because
 * the e-signature route above it is the one to try first and a second open
 * form beside it reads as a choice you have to make before you understand
 * either.
 *
 * The date is REQUIRED and deliberately NOT pre-filled with today. Every
 * other form here defaults a date to `localToday()`, and that is right when
 * the date being recorded is the moment of the entry — a field report, an
 * incident. This one is the GC's date, printed on a document that was
 * signed days or weeks ago; pre-filling today would make "just click
 * through it" produce a wrong date that looks exactly like a right one.
 * (It also sidesteps the hydration trap entirely, since nothing here is
 * computed at render.)
 */
export function RecordExecutedSubcontract({ jobId }: { jobId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
      >
        The GC already sent the executed subcontract
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await recordExecutedSubcontract(jobId, formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      // Any edit invalidates the last refusal — a red sentence that outlives
      // the input it was about ends up contradicting what the form now says.
      onInput={() => setError(null)}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <p className="text-sm text-slate-300">
        Record a subcontract the GC issued and signed off-platform. The signed file is required —
        this is the evidence that lets this job be invoiced, so it has to be something a person can
        go and look at.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Signed subcontract (PDF or photo)
          <input
            type="file"
            name="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className={`${field} file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Date the GC signed it
          <input type="date" name="executedSignedDate" required className={field} />
        </label>
        <label className="flex flex-1 min-w-[160px] flex-col gap-1 text-xs text-slate-400">
          Note (optional)
          <input name="note" placeholder="e.g. Fully executed copy from Turner" className={field} />
        </label>
      </div>

      <p className="text-xs text-slate-500">
        Use the date printed on the contract, not today&apos;s date — lien deadlines and retainage
        are counted from it. Prova records who entered this and when, separately.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Recording…" : "Record executed subcontract"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
