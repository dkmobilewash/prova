"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadDispatchSlip } from "@/lib/actions";
import { singleFileFrom, uploadDocumentFile } from "@/lib/document-upload-client";
import { NoCraftsHint } from "@/components/NoCraftsHint";

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

/**
 * One person a hall can dispatch — a teammate with a login OR a crew member
 * without one. `value` is `user:<id>` / `crew:<id>` (lib/worker-select.ts),
 * the same convention and the same list the time-entry form uses, because
 * the choice decides which TABLE the referral names. It was a bare User id,
 * which made field crew — the people a hiring hall exists to send — the one
 * group this form could not record.
 */
export type DispatchSlipWorker = { value: string; label: string };
export type DispatchSlipCraft = { id: string; label: string };

/**
 * A hiring hall's referral of one worker to this job, and the scan of the
 * slip if there is one.
 *
 * A CLIENT COMPONENT BECAUSE THE FILE CANNOT GO THROUGH THE ACTION (#27).
 * This was a server-rendered `<form action={uploadDispatchSlip…}>` with
 * `encType="multipart/form-data"` on the job page, and that encType is the
 * tell: it was posting the scan through a Server Action, whose body Next
 * caps at 1MB including multipart file parts. The action's own 15MB guard
 * sat behind that and never ran.
 *
 * The slip now goes straight to the blob store under a one-shot token and
 * the action records the URL, which it re-checks against this job's own
 * folder. THE SLIP IS STILL OPTIONAL — some halls dispatch by phone with
 * only a referral number — so the upload step is skipped entirely when no
 * file was chosen, rather than the form insisting on one it never needed.
 *
 * The options are PROPS rather than a fetch: the job page already loads
 * this company's workers and craft classifications for other sections, so
 * passing them costs nothing and keeps this component free of a round trip
 * the page has already made.
 *
 * No date is defaulted here. `localToday()` is the rule for a date that
 * means "now" and this one means the day the hall dispatched somebody,
 * which is routinely last week — and defaulting it would also put a
 * computed value into markup, which is the hydration trap
 * components/localToday.ts documents.
 */
export function DispatchSlipForm({
  jobId,
  workers,
  crafts,
}: {
  jobId: string;
  workers: DispatchSlipWorker[];
  crafts: DispatchSlipCraft[];
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
          // The file first, then the row. Removed from the FormData
          // whatever happens — leaving it in would put the scan back into
          // the Server Action body and reinstate the 1MB failure.
          const file = singleFileFrom(formData, "file");
          formData.delete("file");
          if (file) {
            const uploaded = await uploadDocumentFile("dispatch-slip", jobId, file);
            if (!uploaded.ok) {
              setError(uploaded.error);
              return;
            }
            formData.set("fileUrl", uploaded.fileUrl);
            if (uploaded.fileName) formData.set("fileName", uploaded.fileName);
          }

          const result = await uploadDispatchSlip(jobId, formData);
          if (result.ok) {
            formRef.current?.reset();
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      onInput={() => setError(null)}
      className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Worker
          {/* `worker`, not `employeeUserId`: the value says which table the
              person is in, and a crew id posted as a User id is refused. */}
          <select name="worker" required className={field}>
            {workers.map((worker) => (
              <option key={worker.value} value={worker.value}>
                {worker.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Dispatch date
          <input type="date" name="dispatchDate" required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Craft classification
          <select name="craftClassificationId" defaultValue="" className={field}>
            <option value="">No craft tag</option>
            {crafts.map((craft) => (
              <option key={craft.id} value={craft.id}>
                {craft.label}
              </option>
            ))}
          </select>
          <NoCraftsHint craftCount={crafts.length} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Dispatch #
          <input name="dispatchNumber" placeholder="optional" className={`w-28 ${field}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Slip (optional)
          <input
            type="file"
            name="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className={`${field} file:mr-2 file:rounded file:border-0 file:bg-neutral-800 file:px-2 file:py-1 file:text-ink-label`}
          />
        </label>
        <input name="note" placeholder="Note (optional)" className={field} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Logging…" : "Log dispatch"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
