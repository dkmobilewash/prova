"use client";

import { useState } from "react";
// The delay log's list, not a second copy of it — the schema reuses the
// same enum, so the labels have to be the same words or one report ends up
// unable to add up the other.
import { RESPONSIBLE_PARTIES } from "@/lib/delay-options";

/**
 * The fields a punch item has beyond its description, shared by the create
 * form and the row's edit form — the list-page convention in CLAUDE.md, and
 * the reason the two cannot disagree about what a valid assignee is.
 *
 * Posts plain form fields; `readItemFields` in lib/actions/punchLists.ts
 * parses them and is the only place that decides what they mean.
 */

const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

export type PunchListPeople = {
  /** Team members with a login. */
  users: { id: string; name: string }[];
  /** People on our own payroll, most of whom have no login. */
  crew: { id: string; name: string }[];
  /** Backcharges on this item's job, for pinning evidence to one. */
  backcharges: { id: string; label: string }[];
};

export type PunchItemFieldValues = {
  area: string | null;
  dueOn: Date | null;
  assignedUserId: string | null;
  assignedCrewMemberId: string | null;
  assignedName: string | null;
  causedByOthers: boolean;
  responsibleParty: string | null;
  backchargeId: string | null;
};

export const EMPTY_PUNCH_ITEM_FIELDS: PunchItemFieldValues = {
  area: null,
  dueOn: null,
  assignedUserId: null,
  assignedCrewMemberId: null,
  assignedName: null,
  causedByOthers: false,
  responsibleParty: null,
  backchargeId: null,
};

/** The one value the picker posts. Three exclusive columns, one control —
 * see parseAssignee() for the other half of this. */
function assignedToValue(values: PunchItemFieldValues): string {
  if (values.assignedUserId) return `user:${values.assignedUserId}`;
  if (values.assignedCrewMemberId) return `crew:${values.assignedCrewMemberId}`;
  if (values.assignedName) return "name";
  return "";
}

export function PunchItemFields({
  people,
  values,
  showBlame,
}: {
  people: PunchListPeople;
  values: PunchItemFieldValues;
  /** The "somebody else did this" half. Shown on the row's edit form and
   * not on the create form: on a walkthrough you are typing what is wrong,
   * and whose fault it is becomes a question weeks later when the GC
   * deducts for it. */
  showBlame: boolean;
}) {
  const [assignedTo, setAssignedTo] = useState(assignedToValue(values));
  const [causedByOthers, setCausedByOthers] = useState(values.causedByOthers);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Where
          <input
            type="text"
            name="area"
            defaultValue={values.area ?? ""}
            placeholder="e.g. Level 3 corridor, Unit 214 bath"
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Due
          <input
            type="date"
            name="dueOn"
            defaultValue={values.dueOn ? values.dueOn.toISOString().slice(0, 10) : ""}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Who is fixing it
          <select
            name="assignedTo"
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className={inputClass}
          >
            <option value="">Nobody yet</option>
            {people.crew.length > 0 && (
              <optgroup label="Crew">
                {people.crew.map((person) => (
                  <option key={person.id} value={`crew:${person.id}`}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
            {people.users.length > 0 && (
              <optgroup label="Team">
                {people.users.map((person) => (
                  <option key={person.id} value={`user:${person.id}`}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
            {/* The row that makes this field usable at all: most people who
                fix punch items — a sub, a day hire, somebody else's guy —
                are in neither list above. */}
            <option value="name">Someone else (type a name)</option>
          </select>
        </label>

        {assignedTo === "name" && (
          <label className={labelClass}>
            Their name
            <input
              type="text"
              name="assignedName"
              defaultValue={values.assignedName ?? ""}
              placeholder="e.g. Ramirez Drywall"
              className={inputClass}
            />
          </label>
        )}
      </div>

      {showBlame && (
        <div className="flex flex-col gap-3 rounded-md border border-line-card p-3">
          <label className="flex items-center gap-3 text-sm text-ink-label">
            <input
              type="checkbox"
              name="causedByOthers"
              defaultChecked={values.causedByOthers}
              onChange={(event) => setCausedByOthers(event.target.checked)}
              className="h-6 w-6 accent-blue-500"
            />
            Not our scope — somebody else damaged or blocked this
          </label>

          {causedByOthers && (
            <>
              <label className={labelClass}>
                Who caused it
                <select
                  name="responsibleParty"
                  defaultValue={values.responsibleParty ?? ""}
                  className={inputClass}
                >
                  <option value="">Not recorded</option>
                  {RESPONSIBLE_PARTIES.map((party) => (
                    <option key={party.value} value={party.value}>
                      {party.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={labelClass}>
                Evidence for a backcharge
                <select name="backchargeId" defaultValue={values.backchargeId ?? ""} className={inputClass}>
                  <option value="">Not linked to one</option>
                  {people.backcharges.map((backcharge) => (
                    <option key={backcharge.id} value={backcharge.id}>
                      {backcharge.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-ink-body">
                  {people.backcharges.length === 0
                    ? "No backcharges logged on this job yet. Link one later — the photos and dates on this item are what a deduction gets argued from."
                    : "Links this item to a deduction the GC has issued. Nothing here changes the amount; it is the record of what was actually wrong and who caused it."}
                </span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
