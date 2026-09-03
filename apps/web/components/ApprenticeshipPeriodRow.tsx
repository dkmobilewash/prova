"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteApprenticeshipPeriod, updateApprenticeshipPeriod } from "@/lib/actions";

const field =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";
const linkBtn = "text-xs text-slate-500 underline hover:text-slate-300 disabled:opacity-50";

/** Correcting a recorded period.
 *
 * This exists because a period that can be created and never corrected
 * makes a typo in classroom hours permanent on a record somebody has to
 * defend to a sponsor. The suite's reachable.test.ts caught the actions
 * having no entry point, which is the same defect that once shipped
 * sendOutboundEmail with no form. */
export function ApprenticeshipPeriodRow({
  periodId,
  classroomHours,
  signedOffOn,
  signedOffBy,
  canDelete,
  children,
}: {
  periodId: string;
  classroomHours: number | null;
  signedOffOn: string | null;
  signedOffBy: string | null;
  canDelete: boolean;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (editing) {
    return (
      <li className="py-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updateApprenticeshipPeriod(periodId, formData), () => setEditing(false));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Classroom hours
              <input
                name="classroomHours"
                defaultValue={classroomHours === null ? "" : String(classroomHours)}
                placeholder="blank"
                className={`w-28 ${field}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Signed off on
              <input
                type="date"
                name="signedOffOn"
                defaultValue={signedOffOn ?? ""}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Signed off by
              <input
                name="signedOffBy"
                defaultValue={signedOffBy ?? ""}
                placeholder="optional"
                className={`w-40 ${field}`}
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 py-2">
      {children}
      <span className="flex items-center gap-2">
        <button type="button" disabled={isPending} onClick={() => setEditing(true)} className={linkBtn}>
          Edit
        </button>
        {canDelete &&
          (confirming ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirming(false)}
                className={linkBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(() => deleteApprenticeshipPeriod(periodId), () => setConfirming(false))
                }
                className="text-xs text-red-400 underline hover:text-red-300 disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(true)}
              className={linkBtn}
            >
              Remove
            </button>
          ))}
      </span>
      {error && (
        <p role="alert" className="w-full text-sm text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
