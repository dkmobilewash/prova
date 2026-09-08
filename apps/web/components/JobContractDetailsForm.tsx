"use client";

// The WH-347 header's two job fields — "Project and Location" and
// "Project or Contract No." — as a form. The ONLY write path those two
// columns have; before it existed they were schema-real, page-read and
// written by nothing, so `fileable: true` was unreachable and the red
// banner pointed at a screen that did not exist. The blocking sentences
// in lib/wh347.ts name this form ("Project & contract details"), so its
// title must not drift from them.
//
// Collapsed behind a button, per the list-page conventions — most visits
// to the WH-347 page are to read the grid, and on a job whose details are
// already recorded there is nothing to do here week to week.
//
// ONCE A WEEK HAS BEEN FILED, A RECORDED VALUE LOCKS. Page 1 prints these
// live from the Job, so changing one after a filing would make a reprint
// of a filed week disagree with the copy the agency holds. The action
// (recordJobContractDetails) enforces that; the form ALSO disables the
// locked inputs and says why, because a guard the user only discovers on
// submit reads as a broken button. A field still blank after a filing
// stays editable — a blank was printed as a red sentence, never a value.

import { useRef, useState, useTransition } from "react";
import { recordJobContractDetails } from "@/lib/actions";

const inputClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "flex flex-col text-sm font-medium text-slate-300";

export function JobContractDetailsForm({
  jobId,
  projectLocation,
  contractNumber,
  hasFiling,
}: {
  jobId: string;
  /** The values currently on the Job, so the form edits rather than
   * overwrites blind. Null renders an empty, editable input. */
  projectLocation: string | null;
  contractNumber: string | null;
  /** Whether ANY week of this job has been filed. Decides which inputs
   * are locked — the action re-checks against the database either way,
   * so a stale value here can only mis-render, never mis-write. */
  hasFiling: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const locationLocked = hasFiling && projectLocation != null;
  const numberLocked = hasFiling && contractNumber != null;
  const allRecorded = projectLocation != null && contractNumber != null;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500"
      >
        Project &amp; contract details
        {allRecorded ? "" : " — incomplete"}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        // A disabled input posts nothing, and the action would read that
        // as "" and try to CLEAR the locked value (which it refuses, but
        // with a message about a change nobody made). Post the recorded
        // value explicitly so an untouched locked field is a no-op.
        if (locationLocked) formData.set("projectLocation", projectLocation);
        if (numberLocked) formData.set("contractNumber", contractNumber);
        startTransition(async () => {
          // Returned, not thrown — production redacts a thrown Server
          // Action message to a digest.
          const result = await recordJobContractDetails(formData);
          if (result.ok) {
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex max-w-xl flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <input type="hidden" name="jobId" value={jobId} />

      <div>
        <h2 className="text-sm font-semibold text-slate-200">Project &amp; contract details</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Both print in the WH-347 header on every week&apos;s form.{" "}
          {hasFiling
            ? "A week has already been filed for this job, so a recorded value is locked — a reprint of a filed week must keep saying what the agency's copy says. A blank field can still be filled in."
            : "Nothing has been filed for this job yet, so both can still be edited freely."}
        </p>
      </div>

      <label className={labelClass}>
        Project and location
        <input
          type="text"
          name="projectLocation"
          defaultValue={projectLocation ?? ""}
          disabled={locationLocked}
          placeholder="e.g. 1200 Maple St, Sacramento CA"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Project or contract number
        <span className="text-xs font-normal text-slate-500">
          Issued by the awarding body — it is on the contract, not invented here.
        </span>
        <input
          type="text"
          name="contractNumber"
          defaultValue={contractNumber ?? ""}
          disabled={numberLocked}
          placeholder="e.g. SAC-2026-0041"
          className={inputClass}
        />
      </label>

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {isPending ? "Recording…" : "Record details"}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md px-3 py-2 text-sm text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
