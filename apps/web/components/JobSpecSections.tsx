"use client";

import { useRef, useState, useTransition } from "react";
import { attachSpecSectionDocument, deleteJobSpecSection, saveJobSpecSection } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { uploadDocumentFile } from "@/lib/document-upload-client";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink focus:border-link focus:outline-none";
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";

export type JobSpecRow = {
  id: string;
  sectionNumber: string;
  title: string | null;
  fileName: string | null;
  hasFile: boolean;
  /** False for a won bid's section, which is managed on the bid. */
  ownedByJob: boolean;
};

function Row({ row, companyId }: { row: JobSpecRow; companyId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) setError(result.error ?? "That did not go through.");
      } catch {
        setError("That did not go through. Reload the page and check before trying again.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-body">
          <span className="font-medium text-ink">{row.sectionNumber}</span>
          {row.title ? ` ${row.title}` : ""}
          <span className="text-xs text-ink-muted">
            {" · "}
            {row.ownedByJob ? "added to this job" : "from the winning bid"}
            {" · "}
            {row.fileName ?? "no file yet"}
          </span>
        </p>
        {row.ownedByJob && (
          <RowActions
            className="flex shrink-0 items-center gap-2"
            destructive={
              <ConfirmDelete
                label="Delete"
                confirmLabel="Confirm delete"
                pendingLabel="Deleting…"
                pinned="end"
                pending={isPending}
                describe={`Removes section ${row.sectionNumber} from this job, along with its PDF.`}
                onConfirm={() => run(() => deleteJobSpecSection(row.id))}
              />
            }
          >
            <button type="button" disabled={isPending} className={btn} onClick={() => input.current?.click()}>
              {row.hasFile ? "Replace PDF" : "Attach PDF"}
            </button>
          </RowActions>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label={`PDF for section ${row.sectionNumber}`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          run(async () => {
            const uploaded = await uploadDocumentFile("bid-spec-section", companyId, file);
            if (!uploaded.ok) return uploaded;
            return attachSpecSectionDocument(row.id, uploaded.fileUrl, uploaded.fileName ?? file.name);
          });
        }}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </li>
  );
}

export function JobSpecSections({
  jobId,
  companyId,
  sections,
}: {
  jobId: string;
  companyId: string;
  sections: JobSpecRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6 flex flex-col gap-4">
      {sections.length === 0 ? (
        <p className="text-sm text-ink-muted">No spec sections on this job yet. Add the ones your work falls under.</p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {sections.map((row) => (
            <Row key={row.id} row={row} companyId={companyId} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          setError(null);
          startTransition(async () => {
            try {
              const result = await saveJobSpecSection(jobId, data);
              if (result.ok) form.reset();
              else setError(result.error);
            } catch {
              setError("That did not go through. Reload the page and check before trying again.");
            }
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Section number
          <input name="sectionNumber" required placeholder="09 21 16" className={`${inputClass} w-32`} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Title
          <input name="title" placeholder="Gypsum board assemblies" className={`${inputClass} w-64`} />
        </label>
        <button type="submit" disabled={isPending} className={btn}>
          Add section
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
