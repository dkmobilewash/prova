"use client";

import { useRef, useState, useTransition } from "react";
import { uploadComplianceDocument } from "@/lib/actions";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

/** Upload triggers extractComplianceDocument (a real Claude call reading
 * the file), which can take several seconds — hence the pending state,
 * same pattern as WipNarrativeButton. revalidatePath inside the server
 * action refreshes the list once it lands. */
export function ComplianceUploadForm({ jobs }: { jobs: { id: string; name: string }[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await uploadComplianceDocument(formData);
        formRef.current?.reset();
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
              {job.name}
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
