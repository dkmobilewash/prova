"use client";

import {
  TIME_ENTRY_PAY_TYPE_OPTIONS,
  type TimeEntryPayType,
} from "@/lib/time-entry-correction";

export type TimeEntryEmployeeOption = { id: string; name: string | null; email: string };
export type TimeEntryLineItemOption = { id: string; description: string };
export type TimeEntryCraftOption = { id: string; label: string };

export type TimeEntryFieldDefaults = {
  hours: string;
  payType: TimeEntryPayType | string;
  note: string | null;
  perDiemAmount: string | null;
  travelPayAmount: string | null;
  lineItemId: string | null;
  craftClassificationId: string | null;
};

/** What a correction may NOT touch, shown as text so the person editing can
 * still see whose day it is. */
export type TimeEntryLockedIdentity = { employeeLabel: string; dateLabel: string };

const labelClass = "flex flex-col gap-1 text-xs text-slate-400";
const fieldClass =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const lockedClass =
  "rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-sm text-slate-300";

/**
 * The fields of one field time entry, shared by logging a new one and
 * correcting an existing one (issue #63).
 *
 * One component rather than two forms, which is this app's list-page
 * convention and here it earns it twice over: the names have to match
 * because both forms post to functions that parse them with the same
 * `parseTimeEntryFigures`, and — more to the point — the DIFFERENCE between
 * the two forms is the whole safety property. Two hand-written forms would
 * drift into one offering an employee picker.
 *
 * `locked` is what makes it the correction form. When it is set, the person
 * and the day worked render as TEXT and there is no input for either, so
 * neither is in the submitted FormData at all. The reason they are locked is
 * argued in lib/time-entry-correction.ts and enforced by a database trigger;
 * this component is only the half a user sees.
 *
 * NO DEFAULT DATE, deliberately. `localToday()` is the user's calendar date
 * and it may only be called in a component mounted by a user action —
 * server-rendered markup containing it breaks hydration (CLAUDE.md). The
 * create form is in the page's initial HTML, so the date field starts empty,
 * which is also the honest default: hours are usually entered for a day that
 * has finished, not for today.
 */
export function TimeEntryFields({
  employees,
  lineItems,
  craftOptions,
  defaults,
  locked,
}: {
  /** The people hours can be logged for. Omitted when correcting: the person
   *  is locked, so there is nothing to choose from. */
  employees?: TimeEntryEmployeeOption[];
  lineItems: TimeEntryLineItemOption[];
  craftOptions: TimeEntryCraftOption[];
  defaults?: TimeEntryFieldDefaults;
  locked?: TimeEntryLockedIdentity;
}) {
  return (
    <>
      {locked ? (
        <>
          <div className={labelClass}>
            Employee
            <p className={lockedClass}>{locked.employeeLabel}</p>
          </div>
          <div className={labelClass}>
            Date
            <p className={lockedClass}>{locked.dateLabel}</p>
          </div>
        </>
      ) : (
        <>
          <label className={labelClass}>
            Employee
            <select name="employeeUserId" required className={fieldClass}>
              {(employees ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name ?? member.email}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Date
            <input type="date" name="date" required className={fieldClass} />
          </label>
        </>
      )}

      <label className={labelClass}>
        Hours
        <input
          name="hours"
          placeholder="8"
          required
          defaultValue={defaults?.hours ?? ""}
          className={`w-20 ${fieldClass}`}
        />
      </label>

      <label className={labelClass}>
        Pay type
        <select name="payType" defaultValue={defaults?.payType ?? "STRAIGHT"} className={fieldClass}>
          {TIME_ENTRY_PAY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Cost code / SOV line
        {/* Required on a NEW entry whenever the job has lines: job costing
            and WIP can't place hours on "no line". A correction keeps the
            empty option, so an older entry logged before this rule can still
            have its hours fixed without being forced onto a line. */}
        <select
          name="lineItemId"
          defaultValue={defaults?.lineItemId ?? ""}
          required={!locked && lineItems.length > 0}
          className={fieldClass}
        >
          {!locked && lineItems.length > 0 ? (
            <option value="" disabled>
              Pick a cost code
            </option>
          ) : (
            <option value="">No specific line</option>
          )}
          {lineItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.description}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Craft classification
        <select
          name="craftClassificationId"
          defaultValue={defaults?.craftClassificationId ?? ""}
          className={fieldClass}
        >
          <option value="">No craft tag</option>
          {craftOptions.map((craft) => (
            <option key={craft.id} value={craft.id}>
              {craft.label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Per diem
        <input
          name="perDiemAmount"
          placeholder="optional"
          defaultValue={defaults?.perDiemAmount ?? ""}
          className={`w-24 ${fieldClass}`}
        />
      </label>

      <label className={labelClass}>
        Travel pay
        <input
          name="travelPayAmount"
          placeholder="optional"
          defaultValue={defaults?.travelPayAmount ?? ""}
          className={`w-24 ${fieldClass}`}
        />
      </label>

      <input
        name="note"
        placeholder={locked ? "Note — why it changed" : "Note (optional)"}
        defaultValue={defaults?.note ?? ""}
        className={fieldClass}
      />
    </>
  );
}
