"use client";

import { useRef, useState, useTransition } from "react";
import { uploadComplianceDocument } from "@/lib/actions";
import { singleFileFrom, uploadDocumentFile } from "@/lib/document-upload-client";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

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
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
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
          formRef.current?.reset();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
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
          className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-700"
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
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Uploading & extracting…" : "Upload & extract"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
