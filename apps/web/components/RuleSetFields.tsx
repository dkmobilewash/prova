"use client";

import { inputClass, labelClass } from "@/components/RfiFields";
import { AUTHORITY_LABELS, FILING_FREQUENCY_LABELS } from "@/components/prevailingWageLabels";

export type RuleSetDefaults = {
  name: string;
  jurisdiction: string;
  authority: string;
  dailyOvertimeAfterHours: number | null;
  dailyDoubleTimeAfterHours: number | null;
  weeklyOvertimeAfterHours: number | null;
  seventhDayOvertimeAfterHours: number | null;
  seventhDayDoubleTimeAfterHours: number | null;
  filingFrequency: string;
  filingDueDays: number | null;
  formName: string | null;
  portalUrl: string | null;
  sourceUrl: string | null;
  note: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const num = (value: number | null) => (value === null ? "" : String(value));

/** Shared by create and edit so the two can't drift.
 *
 * Every threshold is optional and the helper text says what blank means,
 * because that is the difference between this app applying rules and
 * asserting law: a blank field is "we haven't looked it up", and the
 * review reports those weeks as unchecked rather than assuming eight. */
export function RuleSetFields({ defaults }: { defaults: RuleSetDefaults }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Name
          <input
            type="text"
            name="name"
            required
            defaultValue={defaults.name}
            placeholder="What you call these rules"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Jurisdiction
          <input
            type="text"
            name="jurisdiction"
            required
            defaultValue={defaults.jurisdiction}
            placeholder="The awarding body's own name for it"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Authority
          <select name="authority" defaultValue={defaults.authority} className={inputClass}>
            {Object.entries(AUTHORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          In force from
          <input
            type="date"
            name="effectiveFrom"
            required
            defaultValue={defaults.effectiveFrom}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          In force until
          <input
            type="date"
            name="effectiveTo"
            defaultValue={defaults.effectiveTo ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">Blank means still current.</span>
        </label>
      </div>

      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        Overtime thresholds
      </p>
      <p className="-mt-2 text-xs text-slate-500">
        Read these off the awarding body&apos;s own documents and put the citation in Source below.
        <span className="text-slate-400">
          {" "}
          Leave a field blank if you haven&apos;t looked it up — a week is then reported as unchecked
          rather than measured against a number nobody gave us.
        </span>{" "}
        Zero is different from blank: it means the premium starts at the first hour.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Daily overtime after
          <input
            type="number"
            name="dailyOvertimeAfterHours"
            step="0.25"
            min="0"
            max="24"
            defaultValue={num(defaults.dailyOvertimeAfterHours)}
            placeholder="hours"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Daily double time after
          <input
            type="number"
            name="dailyDoubleTimeAfterHours"
            step="0.25"
            min="0"
            max="24"
            defaultValue={num(defaults.dailyDoubleTimeAfterHours)}
            placeholder="hours"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Weekly overtime after
          <input
            type="number"
            name="weeklyOvertimeAfterHours"
            step="0.25"
            min="0"
            max="168"
            defaultValue={num(defaults.weeklyOvertimeAfterHours)}
            placeholder="hours"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          7th straight day — OT after
          <input
            type="number"
            name="seventhDayOvertimeAfterHours"
            step="0.25"
            min="0"
            max="24"
            defaultValue={num(defaults.seventhDayOvertimeAfterHours)}
            placeholder="hours"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          7th straight day — 2× after
          <input
            type="number"
            name="seventhDayDoubleTimeAfterHours"
            step="0.25"
            min="0"
            max="24"
            defaultValue={num(defaults.seventhDayDoubleTimeAfterHours)}
            placeholder="hours"
            className={inputClass}
          />
        </label>
      </div>

      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">Filing</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Frequency
          <select name="filingFrequency" defaultValue={defaults.filingFrequency} className={inputClass}>
            {Object.entries(FILING_FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Due days after period ends
          <input
            type="number"
            name="filingDueDays"
            step="1"
            min="0"
            max="365"
            defaultValue={defaults.filingDueDays === null ? "" : String(defaults.filingDueDays)}
            placeholder="days"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Used by the certified payroll alert. Blank falls back to its generic horizon, and the
            alert says which it used.
          </span>
        </label>
        <label className={labelClass}>
          Form
          <input
            type="text"
            name="formName"
            defaultValue={defaults.formName ?? ""}
            placeholder="e.g. WH-347"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Filing portal
          <input
            type="url"
            name="portalUrl"
            defaultValue={defaults.portalUrl ?? ""}
            placeholder="https://…"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Source
          <input
            type="url"
            name="sourceUrl"
            defaultValue={defaults.sourceUrl ?? ""}
            placeholder="https://… where these rules are published"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            A threshold with no citation is somebody&apos;s memory.
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Note
        <textarea
          name="note"
          rows={2}
          defaultValue={defaults.note ?? ""}
          placeholder="Optional — anything the fields above can't hold"
          className={inputClass}
        />
      </label>
    </>
  );
}
