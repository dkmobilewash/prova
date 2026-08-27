"use client";

import { useState } from "react";
import { INCIDENT_CLASSIFICATIONS, INCIDENT_OUTCOMES } from "@/components/safetyLabels";

export const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
export const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type JobOption = { id: string; name: string };

export type IncidentDefaults = {
  occurredAt: string;
  jobId: string | null;
  employeeName: string;
  jobTitle: string | null;
  location: string | null;
  description: string;
  classification: string;
  outcome: string;
  daysAway: number | null;
  daysRestricted: number | null;
};

/** Every incident field, shared by the create form and the inline edit so
 * the two can't drift. `lockDate` is set on edit: the date of the incident
 * is what the case number was issued against, so it isn't editable. */
export function SafetyIncidentFields({
  jobs,
  defaults,
  lockDate = false,
}: {
  jobs: JobOption[];
  defaults: IncidentDefaults;
  lockDate?: boolean;
}) {
  const [outcome, setOutcome] = useState(defaults.outcome);

  // Day counts only mean anything for these two outcomes; showing them
  // otherwise invites numbers that don't belong on the log.
  const showDays = outcome === "DAYS_AWAY" || outcome === "RESTRICTED_OR_TRANSFER";

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date of incident
          {lockDate ? (
            <span className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-400">
              {defaults.occurredAt} · not editable
            </span>
          ) : (
            <input
              type="date"
              name="occurredAt"
              required
              defaultValue={defaults.occurredAt}
              // An incident can't have happened in the future, and the
              // date is not editable afterwards — it picks the case-number
              // series. A typo'd year here is unfixable without deleting
              // the case, which retires its number for good.
              max={defaults.occurredAt}
              className={inputClass}
            />
          )}
        </label>
        <label className={labelClass}>
          Job (optional)
          <select name="jobId" defaultValue={defaults.jobId ?? ""} className={inputClass}>
            <option value="">Not job-related (yard, shop, travel)</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Employee name
          <input
            type="text"
            name="employeeName"
            required
            defaultValue={defaults.employeeName}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Job title
          <input
            type="text"
            name="jobTitle"
            defaultValue={defaults.jobTitle ?? ""}
            placeholder="e.g. Journeyman framer"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        Where it happened
        <input
          type="text"
          name="location"
          defaultValue={defaults.location ?? ""}
          placeholder="e.g. 3rd floor east corridor"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        What happened
        <textarea
          name="description"
          required
          rows={2}
          defaultValue={defaults.description}
          placeholder="Object involved, what the employee was doing, what part of the body"
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Classification
          <select name="classification" defaultValue={defaults.classification} className={inputClass}>
            {INCIDENT_CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Outcome
          <select
            name="outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className={inputClass}
          >
            {INCIDENT_OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showDays && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Days away from work
            <input
              type="number"
              name="daysAway"
              min={0}
              defaultValue={defaults.daysAway ?? ""}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Days restricted or transferred
            <input
              type="number"
              name="daysRestricted"
              min={0}
              defaultValue={defaults.daysRestricted ?? ""}
              className={inputClass}
            />
          </label>
        </div>
      )}
    </>
  );
}
