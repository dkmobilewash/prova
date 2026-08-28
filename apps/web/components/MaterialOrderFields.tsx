"use client";

import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";

export type VendorOption = { id: string; name: string };

export type MaterialOrderDefaults = {
  description: string;
  vendorId: string;
  vendorReference: string | null;
  notes: string | null;
  promisedFor: string | null;
};

/** The order-identity half of a material order, shared by create and edit
 * so the two can't drift. The job select only appears on create — the job
 * and the order number are what the vendor's paperwork is filed under. */
export function MaterialOrderFields({
  defaults,
  vendors,
  jobs,
  defaultJobId,
}: {
  defaults: MaterialOrderDefaults;
  vendors: VendorOption[];
  jobs?: JobOption[];
  defaultJobId?: string;
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
        Vendor
        <select name="vendorId" required defaultValue={defaults.vendorId} className={inputClass}>
          <option value="" disabled>
            Choose a vendor
          </option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          Who owes you the material. This is who the late list points at.
        </span>
      </label>

      <label className={labelClass}>
        What was ordered
        <textarea
          name="description"
          rows={2}
          required
          defaultValue={defaults.description}
          placeholder="e.g. 20ga 3-5/8 studs and track, level 2 — enough that a reader knows which order this number points at."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Their order number
          <input
            type="text"
            name="vendorReference"
            defaultValue={defaults.vendorReference ?? ""}
            placeholder="e.g. SO-44821"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            So a phone call can open with the number they&apos;ll recognise.
          </span>
        </label>
        <label className={labelClass}>
          Promised for
          <input
            type="date"
            name="promisedFor"
            defaultValue={defaults.promisedFor ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Leave blank if they haven&apos;t committed to a date — a guessed date would
            manufacture lateness nobody agreed to.
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          placeholder="Anything that matters later — who you spoke to, what they said about the date."
          className={inputClass}
        />
      </label>
    </>
  );
}
