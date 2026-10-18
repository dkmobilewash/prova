"use client";

import { useRef, useState, useTransition } from "react";
import { uploadComplianceDocument } from "@/lib/actions";
import { singleFileFrom, uploadDocumentFile } from "@/lib/document-upload-client";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

/** Upload triggers extractComplianceDocument (a real Claude call reading
 * the file), which can take several seconds — hence the pending state,
 * same pattern as WipNarrativeButton. revalidatePath inside the server
 * action refreshes the list once it lands.
 *
 * THE FILE GOES STRAIGHT TO THE BLOB STORE, not through the action (#27).
 * A scanned COI or a certified payroll report is several megabytes and a
 * Server Action body is capped at 1MB, so this form's own normal case was
 * rejected by the framework before the 15MB guard behind it could run. The
 * document is uploaded first and only its URL is sent; the action reads
 * the bytes back out of the store for Claude, which is the one thing that
 * still needs them server-side.
 *
 * `companyId` IS A PROP BECAUSE THE PATHNAME NEEDS IT. A compliance
 * document is owned by the company rather than by a job, so it lands under
 * `compliance/<companyId>/` and the browser has to name that path when it
 * asks for a token. Nothing is disclosed by it: the id is already in every
 * document URL this same page renders. The route does not TRUST it — it
 * builds the prefix from the session's own company, so a tampered value
 * produces a pathname mismatch and no token.
 *
 * THE ACTION RETURNS A RESULT NOW rather than throwing. It threw before,
 * and production redacts a thrown Server Action message to a digest, so
 * the `catch` below was rendering reference numbers. The `try` stays for
 * the genuinely unexpected. */
export function ComplianceUploadForm({ companyId, jobs }: { companyId: string; jobs: JobOption[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [charged, setCharged] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCharged(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        // The file first, then the row. It is removed from the FormData
        // whatever happens — leaving it in would put the document back
        // into the Server Action body and reinstate the 1MB failure.
        const file = singleFileFrom(formData, "file");
        formData.delete("file");
        if (!file) {
          setError("Choose a document to upload.");
          return;
        }
        const uploaded = await uploadDocumentFile("compliance-document", companyId, file);
        if (!uploaded.ok) {
          setError(uploaded.error);
          return;
        }
        formData.set("fileUrl", uploaded.fileUrl);
        if (uploaded.fileName) formData.set("fileName", uploaded.fileName);

        const result = await uploadComplianceDocument(formData);
        if (result.ok) {
          // Only on success. A failed upload leaves every field exactly as
          // the person typed it, so a refusal they can act on — a document
          // over the single-upload ceiling, a month that has run out —
          // costs them the file picker and nothing else.
          formRef.current?.reset();
          setCharged(
            `Read ${result.value.note} — ${result.value.pagesLeft} document ${
              result.value.pagesLeft === 1 ? "page" : "pages"
            } left in this month's allowance.`,
          );
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }

  // Collapsed behind a button like every other add form (CLAUDE.md, list
  // pages). It stays open after a successful upload so the allowance note
  // under the buttons is still there to read.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Upload a document
      </button>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className={labelClass}>
        Document (PDF, PNG, JPEG, or WEBP)
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="text-sm text-ink-label file:mr-3 file:rounded-md file:border-0 file:bg-rail-hover file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-lift"
        />
      </label>
      <label className={labelClass}>
        Job (optional — leave blank for a company-level document)
        <select name="jobId" defaultValue="" className={inputClass}>
          <option value="">— Company-level —</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {jobPickerLabel(job)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Uploading & extracting…" : "Upload & extract"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
            setCharged(null);
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {charged && <p className="text-sm text-ink-muted">{charged}</p>}
    </form>
  );
}
