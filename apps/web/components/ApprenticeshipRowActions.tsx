"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteApprenticeshipEnrollment,
  recordApprenticeshipPeriod,
  updateApprenticeshipEnrollment,
} from "@/lib/actions";

const field =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";
const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function ApprenticeshipRowActions({
  enrollmentId,
  nextPeriod,
  canDelete,
  enrollment,
}: {
  enrollmentId: string;
  nextPeriod: number;
  canDelete: boolean;
  /** Every field updateApprenticeshipEnrollment writes. It overwrites the
   *  whole row, so anything missing here would be silently cleared on
   *  save — which is why the query surfaces the raw dates rather than only
   *  the derived state. */
  enrollment: {
    sponsorName: string;
    programNumber: string | null;
    completedOn: string | null;
    cancelledOn: string | null;
    requiredOjtHoursPerPeriod: number | null;
    requiredClassroomHoursPerPeriod: number | null;
    note: string | null;
  };
}) {
  const [mode, setMode] = useState<"view" | "period" | "edit">("view");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
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

  if (mode === "edit") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => updateApprenticeshipEnrollment(enrollmentId, formData), () =>
            setMode("view"),
          );
        }}
        onInput={() => setError(null)}
        className="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Sponsor
            <input
              name="sponsorName"
              defaultValue={enrollment.sponsorName}
              className={`w-56 ${field}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Program number
            <input
              name="programNumber"
              defaultValue={enrollment.programNumber ?? ""}
              placeholder="optional"
              className={`w-40 ${field}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Completed on
            {/* Not defaulted to today. The date an indenture completed is
                the sponsor's, entered from their paperwork — the same rule
                every other evidence date on this screen follows. */}
            <input
              type="date"
              name="completedOn"
              defaultValue={enrollment.completedOn ?? ""}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Cancelled on
            <input
              type="date"
              name="cancelledOn"
              defaultValue={enrollment.cancelledOn ?? ""}
              className={field}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Required OJT hours / period
            <input
              name="requiredOjtHoursPerPeriod"
              defaultValue={
                enrollment.requiredOjtHoursPerPeriod === null
                  ? ""
                  : String(enrollment.requiredOjtHoursPerPeriod)
              }
              placeholder="blank"
              className={`w-32 ${field}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Required classroom hours / period
            <input
              name="requiredClassroomHoursPerPeriod"
              defaultValue={
                enrollment.requiredClassroomHoursPerPeriod === null
                  ? ""
                  : String(enrollment.requiredClassroomHoursPerPeriod)
              }
              placeholder="blank"
              className={`w-32 ${field}`}
            />
          </label>
        </div>

        <input
          name="note"
          defaultValue={enrollment.note ?? ""}
          placeholder="Note (optional)"
          className={field}
        />

        <p className="text-xs text-slate-500">
          An indenture is either completed or cancelled, not both — filling in both dates is
          refused rather than resolved, because quietly picking one would bury a data-entry error
          on a record somebody may have to defend. Clearing both puts it back to active.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save enrolment"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setMode("view");
              setError(null);
            }}
            className={btn}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (mode === "period") {
    return (
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => recordApprenticeshipPeriod(enrollmentId, formData), () => {
            formRef.current?.reset();
            setMode("view");
          });
        }}
        onInput={() => setError(null)}
        className="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Period
            <input
              name="periodNumber"
              defaultValue={String(nextPeriod)}
              className={`w-20 ${field}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Classroom hours
            <input name="classroomHours" placeholder="blank" className={`w-28 ${field}`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Signed off on
            {/* Not defaulted. A sign-off has the sponsor's date on it, and
                a period left open is a real and common state. */}
            <input type="date" name="signedOffOn" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Signed off by
            <input name="signedOffBy" placeholder="optional" className={`w-40 ${field}`} />
          </label>
        </div>

        <p className="text-xs text-slate-500">
          Leave “signed off on” blank to record a period that is still open. Blank classroom hours
          means nobody has recorded them — which is not the same as attending none.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Record period"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setMode("view");
              setError(null);
            }}
            className={btn}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
      {/* BOTH hidden while a delete is armed. Browser testing found "Record
          a period" sitting live beside "Confirm remove" -- an ordinary
          action adjacent to a destructive one, both enabled, is how
          somebody confirms a removal they meant to cancel.

          "Edit enrolment" is inside the same guard rather than beside it.
          Merging this branch with that fix produced a CLEAN merge that put
          the new button in exactly the position the fix had just emptied,
          so the guard wraps the group and not one button -- otherwise the
          next action added here reintroduces the bug for a third time. */}
      {!confirming && (
        <>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("period")}
            className={btn}
          >
            Record a period
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("edit")}
            className={btn}
          >
            Edit enrolment
          </button>
        </>
      )}

      {canDelete &&
        (confirming ? (
          <>
            {/* Cancel takes the position "Remove" occupied, so a hurried
                second click costs a click rather than the record. */}
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(false)}
              className={btn}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(() => deleteApprenticeshipEnrollment(enrollmentId), () => setConfirming(false))
              }
              className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              {isPending ? "Removing…" : "Confirm remove"}
            </button>
            <span className="text-xs text-slate-500">
              Removes the registration and its periods. No timesheet is touched.
            </span>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(true)}
            className={btn}
          >
            Remove
          </button>
        ))}

      {error && (
        <p role="alert" className="w-full text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
