"use client";

import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";
import { jobPickerLabel } from "@/components/jobLabels";
import { localToday } from "@/components/localToday";

export type PurchaseOrderVendorOption = {
  id: string;
  name: string;
  vendorNumber: string | null;
  address: string | null;
};

export type PurchaseOrderDefaults = {
  vendorId: string;
  title: string;
  shipToAddress: string | null;
  paymentTerms: string | null;
  awardedOn: string | null;
  expectedOn: string | null;
  notes: string | null;
};

/**
 * The heading of a purchase order, shared by the create form and the inline
 * edit form so the two cannot drift apart.
 *
 * The JOB select appears on create only. A purchase order's job and number
 * are what the vendor files it under and what their invoice quotes back
 * months later, so neither is editable afterwards — moving one retroactively
 * rewrites a commitment somebody else is holding a copy of.
 *
 * `localToday()` is safe here for the reason its own comment gives: this
 * component is only ever mounted by a user action — the create form is
 * behind a button, the edit form behind "Edit" — never in server-rendered
 * markup, so there is no server/client date to disagree about.
 */
export function PurchaseOrderFields({
  defaults,
  vendors,
  jobs,
  defaultJobId,
}: {
  defaults: PurchaseOrderDefaults;
  vendors: PurchaseOrderVendorOption[];
  /** Create only. Absent on edit, where the job is fixed. */
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
                {jobPickerLabel(job)}
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
              {vendor.vendorNumber ? ` (#${vendor.vendorNumber})` : ""}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">
          Their vendor number and address come from the vendor record and print on the order — set
          them once on the Vendors page rather than retyping them here.
        </span>
      </label>

      <label className={labelClass}>
        What this order is for
        <input
          type="text"
          name="title"
          required
          defaultValue={defaults.title}
          placeholder="e.g. Quiet Rock and finishing materials — level 3"
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          One line, at the top of the order. The detail goes on the lines below it.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date awarded
          <input
            type="date"
            name="awardedOn"
            required
            defaultValue={defaults.awardedOn ?? localToday()}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            The day you actually awarded it, not today — backdate it when you&apos;re catching up.
          </span>
        </label>
        <label className={labelClass}>
          Expected
          <input
            type="date"
            name="expectedOn"
            defaultValue={defaults.expectedOn ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            Leave blank until they commit to a date. A guessed one manufactures lateness nobody
            agreed to.
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Payment terms
        <input
          type="text"
          name="paymentTerms"
          defaultValue={defaults.paymentTerms ?? ""}
          placeholder="e.g. Net 30, or 2% 10 net 30"
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">In their words, exactly as they quoted them.</span>
      </label>

      <label className={labelClass}>
        Ship to
        <textarea
          name="shipToAddress"
          rows={2}
          defaultValue={defaults.shipToAddress ?? ""}
          placeholder="Job site address, gate, or the shop — wherever this particular order goes."
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          Per order, not per job: one order goes to the site and the next to the shop.
        </span>
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          placeholder="Anything the vendor needs to know — delivery window, who to call on site."
          className={inputClass}
        />
      </label>
    </>
  );
}
