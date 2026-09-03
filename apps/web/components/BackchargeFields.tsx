"use client";

import { BACKCHARGE_CATEGORIES } from "@/components/backchargeLabels";
import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";

export type BackchargeDefaults = {
  gcReference: string | null;
  category: string;
  description: string;
  claimedAmount: string;
  issuedOn: string | null;
  receivedOn: string | null;
  respondByDate: string | null;
};

/**
 * The notice half of a backcharge, shared by create and edit so the two
 * can't drift.
 *
 * `locked` renders the GC's own figures as text instead of inputs, on a
 * backcharge we have already answered. Those three fields are what the GC
 * put in writing, and a savings figure computed against an amount someone
 * could still edit afterwards would be reporting a claim nobody ever made.
 * The server enforces the same rule — this only stops the form from
 * offering an edit that would be refused.
 */
export function BackchargeFields({
  defaults,
  jobs,
  defaultJobId,
  locked = false,
}: {
  defaults: BackchargeDefaults;
  jobs?: JobOption[];
  defaultJobId?: string;
  locked?: boolean;
}) {
  return (
    <>
      {jobs && (
        <label className={labelClass}>
          Job
          <select name="jobId" required defaultValue={defaultJobId ?? ""} className={inputClass}>
            <option value="" disabled>
              Choose a job
            </option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className={labelClass}>
        What it&apos;s for
        <textarea
          name="description"
          required
          rows={2}
          defaultValue={defaults.description}
          placeholder="As the GC described it — e.g. 'cleanup of level 3 corridor, our debris, 2 labourers 8 hrs'"
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Category
          <select name="category" defaultValue={defaults.category} className={inputClass}>
            {BACKCHARGE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {locked ? (
          <div className={labelClass}>
            Amount claimed
            <p className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-slate-300">
              ${defaults.claimedAmount}
            </p>
            <span className="text-xs text-slate-500">
              Locked — we&apos;ve answered this one, so this is what the GC claimed on the record.
            </span>
          </div>
        ) : (
          <label className={labelClass}>
            Amount claimed
            <input
              type="number"
              name="claimedAmount"
              required
              step="0.01"
              min="0.01"
              defaultValue={defaults.claimedAmount}
              placeholder="0.00"
              className={inputClass}
            />
          </label>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {locked ? (
          <div className={labelClass}>
            Date the GC issued it
            <p className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
              {defaults.issuedOn ?? "—"}
            </p>
          </div>
        ) : (
          <label className={labelClass}>
            Date the GC issued it
            <input
              type="date"
              name="issuedOn"
              required
              defaultValue={defaults.issuedOn ?? ""}
              className={inputClass}
            />
            <span className="text-xs text-slate-500">
              The date on their notice, not today — backdate one you&apos;re entering late.
            </span>
          </label>
        )}

        <label className={labelClass}>
          Date we received it
          <input
            type="date"
            name="receivedOn"
            defaultValue={defaults.receivedOn ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Often weeks after they dated it, which is most of a response window gone.
          </span>
        </label>

        <label className={labelClass}>
          Object in writing by
          <input
            type="date"
            name="respondByDate"
            defaultValue={defaults.respondByDate ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            What the subcontract allows. Blank means we haven&apos;t looked it up — not that there
            isn&apos;t one.
          </span>
        </label>
      </div>

      {locked ? (
        <div className={labelClass}>
          The GC&apos;s reference
          <p className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
            {defaults.gcReference || "—"}
          </p>
        </div>
      ) : (
        <label className={labelClass}>
          The GC&apos;s reference
          <input
            type="text"
            name="gcReference"
            defaultValue={defaults.gcReference ?? ""}
            placeholder="e.g. BC-014, or the deduction line on their pay app"
            className={inputClass}
          />
        </label>
      )}
    </>
  );
}
