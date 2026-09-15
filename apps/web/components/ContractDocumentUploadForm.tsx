"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadContractDocument } from "@/lib/actions";
import { singleFileFrom, uploadDocumentFile } from "@/lib/document-upload-client";

/**
 * The GC's own agreement, and every later amendment, attached to the job.
 *
 * A CLIENT COMPONENT BECAUSE THE FILE CANNOT GO THROUGH THE ACTION (#27).
 * This was `<form action={uploadContractDocument.bind(null, job.id)}>` on
 * the job page — the plainest possible server form, and completely broken
 * for its own purpose: Next caps a Server Action body at 1MB, multipart
 * file parts included, so a real subcontract PDF was rejected by the
 * framework with an opaque error and the action's 15MB guard never ran.
 *
 * The bytes now go straight to the blob store under a one-shot token
 * (`app/api/documents/upload/route.ts`) and the action is given the URL,
 * which it re-checks against this job's own folder rather than trusting.
 *
 * Nothing about the form's SHAPE changed — same two fields, same labels,
 * same place on the page. What changed is where the bytes go and that a
 * refusal is now rendered beside the form instead of taking the whole page
 * to the error boundary.
 *
 * The button is disabled while anything is in flight: `create` is not
 * idempotent here, a second click would write a second version of the same
 * document, and this app has a standing scar from buttons that stayed live
 * through a slow round-trip (#19).
 */
export function ContractDocumentUploadForm({
  jobId,
  hasDocuments,
}: {
  jobId: string;
  hasDocuments: boolean;
}) {
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
          // The file first, then the row. It is removed from the FormData
          // whatever happens — leaving it in would put the PDF back into
          // the Server Action body and reinstate the 1MB failure.
          const file = singleFileFrom(formData, "file");
          formData.delete("file");
          if (!file) {
            setError("Choose the document to upload.");
            return;
          }
          const uploaded = await uploadDocumentFile("contract-document", jobId, file);
          if (!uploaded.ok) {
            setError(uploaded.error);
            return;
          }
          formData.set("fileUrl", uploaded.fileUrl);
          if (uploaded.fileName) formData.set("fileName", uploaded.fileName);

          const result = await uploadContractDocument(jobId, formData);
          if (result.ok) {
            formRef.current?.reset();
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      // Any edit invalidates the last refusal — a red sentence that
      // outlives the input it was about contradicts what the form now says.
      onInput={() => setError(null)}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          {hasDocuments ? "Upload an amendment" : "Upload the agreement"}
          <input
            type="file"
            name="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-700"
          />
        </label>
        <label className="flex flex-1 min-w-[180px] flex-col gap-1 text-sm text-slate-300">
          Note (optional)
          <input
            name="note"
            placeholder={hasDocuments ? "e.g. Amendment #1: added scope" : ""}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Uploading…" : "Upload"}
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
