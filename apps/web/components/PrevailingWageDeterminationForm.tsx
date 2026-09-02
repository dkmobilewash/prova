"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPrevailingWageDetermination } from "@/lib/actions";

const field =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

/** Attaches a wage determination -- a document, or a link to one.
 *
 * This was a plain server-rendered `<form action={serverAction}>`, and the
 * action `throw`n. Production redacts a thrown Server Action message to a
 * digest, so submitting with both the file and the link empty -- the two
 * inputs LABELLED OPTIONAL -- rendered the whole-page error boundary with a
 * reference number instead of saying which field to fill. Browser testing
 * hit it three times in a row and reasonably read it as data loss.
 *
 * So the rule it broke is the reason this component exists: an expected
 * failure is RETURNED and rendered next to the field, and `throw` is kept
 * for genuine bugs. The error also clears the moment anything is edited --
 * a refusal that outlives the input it was about ends up contradicting
 * what the form now says. */
export function PrevailingWageDeterminationForm({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await uploadPrevailingWageDetermination(jobId, formData);
          if (result.ok) {
            formRef.current?.reset();
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      // Any edit invalidates the last refusal, so drop it rather than leave
      // a red sentence sitting under a field that no longer says what it
      // was complaining about.
      onInput={() => setError(null)}
      className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Jurisdiction
          <input
            name="jurisdiction"
            placeholder="e.g. California, federal (Davis-Bacon)"
            className={`w-56 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Document
          <input
            type="file"
            name="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className={`${field} file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Or source link
          <input name="sourceUrl" placeholder="https://sam.gov/..." className={`w-48 ${field}`} />
        </label>
        <input name="note" placeholder="Note (optional)" className={field} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Attaching…" : "Attach"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        A document or a link — either one is enough, but one of them is needed.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
