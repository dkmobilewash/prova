"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPrevailingWageDetermination } from "@/lib/actions";
import { singleFileFrom, uploadDocumentFile } from "@/lib/document-upload-client";
import { DeterminationFactsFields } from "@/components/DeterminationFactsFields";

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const factsLabel = "flex flex-col gap-1 text-xs text-ink-body";

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
 * what the form now says.
 *
 * THE DOCUMENT GOES STRAIGHT TO THE BLOB STORE, not through the action
 * (#27). A wage determination is a government PDF and they run to several
 * megabytes; a Server Action body is capped at 1MB, so attaching one used
 * to fail in the framework with nothing this form could render. The file
 * is uploaded first, and only its URL is sent to the action — which
 * re-checks that URL against this job's own folder rather than trusting
 * it. A failed upload is rendered in the same place as a failed save,
 * because from where the person is standing it is the same failure. */
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
          // The file first, then the row. The action is told the URL and
          // never sees the bytes. `file` is deliberately REMOVED from the
          // FormData afterwards: leaving it in would put the whole
          // document back into the Server Action body and reinstate the
          // exact 1MB failure this change exists to remove.
          const file = singleFileFrom(formData, "file");
          formData.delete("file");
          if (file) {
            const uploaded = await uploadDocumentFile("prevailing-wage", jobId, file);
            if (!uploaded.ok) {
              setError(uploaded.error);
              return;
            }
            formData.set("fileUrl", uploaded.fileUrl);
            if (uploaded.fileName) formData.set("fileName", uploaded.fileName);
          }
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
      className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Jurisdiction
          <input
            name="jurisdiction"
            placeholder="e.g. California, federal (Davis-Bacon)"
            className={`w-56 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Document
          <input
            type="file"
            name="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className={`${field} file:mr-2 file:rounded file:border-0 file:bg-neutral-800 file:px-2 file:py-1 file:text-ink-label`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Or source link
          <input name="sourceUrl" placeholder="https://sam.gov/..." className={`w-48 ${field}`} />
        </label>
        <input name="note" placeholder="Note (optional)" className={field} />
      </div>

      <p className="text-xs text-ink-muted">
        A document or a link — either one is enough, but one of them is needed.
      </p>

      {/* What the document says about itself. Optional on attach — they can
          be entered on the row afterwards — but this is the moment the
          document is open in front of the person, so they are offered here.
          The standing line the tab derives from them says "unchecked" until
          the issue date is in, never a guess. */}
      <DeterminationFactsFields fieldClassName={field} labelClassName={factsLabel} />
      <p className="text-xs text-ink-muted">
        Read the number, dates and the asterisk off the determination itself. Leave blank what it
        doesn&rsquo;t say; you can add them on the row later. No rate is entered anywhere — the rate
        stays on the document.
      </p>

      {/* The submit sits BELOW the document facts, not beside the
          jurisdiction. It used to be the last control in the top row, which
          on a phone put it above four fields nobody had scrolled to — and
          those four fields are the entire point of this phase. */}
      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Attaching…" : "Attach"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-tag-rose-ink">
          {error}
        </p>
      )}
    </form>
  );
}
