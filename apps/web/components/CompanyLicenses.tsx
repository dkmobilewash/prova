"use client";

import { useState, useTransition } from "react";
import { createCompanyLicense, deleteCompanyLicense, updateCompanyLicense } from "@/lib/actions";
import { classifyRenewal, renewalTiming } from "@/lib/compliance-expiry";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * Contractor licences a company holds.
 *
 * This existed as a model, an index and a renewals row for weeks with no
 * way to create one — the renewals panel ranks four record types and a
 * quarter of it had no data path at all. Found by testing rather than by
 * reading: the browser run confirmed no licence form anywhere across all
 * sixteen routes.
 *
 * One row per licence HELD, not per state. The schema is explicit about
 * why: Colorado has no state licence, only municipal ones, so a company
 * working in two Colorado cities holds two rows here and no "Colorado"
 * row exists.
 */

const JURISDICTION_LABELS = [
  { value: "STATE", label: "State" },
  { value: "COUNTY", label: "County" },
  { value: "CITY", label: "City" },
] as const;

const STATUS_LABELS = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "PENDING", label: "Pending" },
  { value: "INACTIVE", label: "Inactive" },
] as const;

export type LicenceData = {
  id: string;
  jurisdictionType: string;
  jurisdictionName: string;
  classificationCode: string | null;
  classificationLabel: string | null;
  licenseNumber: string;
  issueDate: string | null;
  expirationDate: string | null;
  status: string;
  bondNumber: string | null;
};

export type ClassificationReference = { jurisdictionName: string; code: string; label: string };

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-slate-400";

function statusLabel(value: string) {
  const known = STATUS_LABELS.find((s) => s.value === value);
  if (known) return known.label;
  // A row can still store EXPIRED from before that stopped being settable.
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * One field set, used by both the add form and the inline edit.
 *
 * Shared rather than duplicated so the two can never drift into accepting
 * different things — the add form validating something the edit form
 * doesn't is how a record gets into a state its own form can't produce.
 */
function LicenceFields({
  licence,
  classifications,
}: {
  licence?: LicenceData;
  classifications: ClassificationReference[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={labelClass}>
        Issued by
        <select
          name="jurisdictionType"
          defaultValue={licence?.jurisdictionType ?? "STATE"}
          className={inputClass}
        >
          {JURISDICTION_LABELS.map((j) => (
            <option key={j.value} value={j.value}>
              {j.label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Jurisdiction
        <input
          name="jurisdictionName"
          required
          defaultValue={licence?.jurisdictionName ?? ""}
          placeholder="California, or City of Longmont, CO"
          className={`w-56 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Licence number
        <input
          name="licenseNumber"
          required
          defaultValue={licence?.licenseNumber ?? ""}
          placeholder="C-9 998877"
          className={`w-40 ${inputClass}`}
        />
      </label>

      {/* A datalist, not a select: licensing structure isn't uniform —
          CA/AZ split by trade, UT combines several into one code, Colorado
          has no classification system at all. Suggestions appear only for
          jurisdictions someone has actually seeded, and the field stays
          free text everywhere else rather than forcing a wrong code. */}
      <label className={labelClass}>
        Classification code
        <input
          name="classificationCode"
          defaultValue={licence?.classificationCode ?? ""}
          list="licence-classification-codes"
          placeholder="optional"
          className={`w-32 ${inputClass}`}
        />
      </label>
      <datalist id="licence-classification-codes">
        {classifications.map((c) => (
          <option key={`${c.jurisdictionName}-${c.code}`} value={c.code}>
            {c.jurisdictionName} — {c.label}
          </option>
        ))}
      </datalist>

      <label className={labelClass}>
        Classification
        <input
          name="classificationLabel"
          defaultValue={licence?.classificationLabel ?? ""}
          placeholder="optional"
          className={`w-44 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Issued
        <input
          type="date"
          name="issueDate"
          defaultValue={licence?.issueDate ?? ""}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Expires
        <input
          type="date"
          name="expirationDate"
          defaultValue={licence?.expirationDate ?? ""}
          className={inputClass}
        />
      </label>

      {/* No "Expired" option, deliberately. Whether a licence has expired
          is what the date above says; storing it as a status too is a
          second copy of a derived fact, and the renewals panel exists in
          part to report the two disagreeing. */}
      <label className={labelClass}>
        Status
        <select name="status" defaultValue={licence?.status ?? "ACTIVE"} className={inputClass}>
          {STATUS_LABELS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Bond number
        <input
          name="bondNumber"
          defaultValue={licence?.bondNumber ?? ""}
          placeholder="optional"
          className={`w-36 ${inputClass}`}
        />
      </label>
    </div>
  );
}

function LicenceRow({
  licence,
  classifications,
  today,
  canManage,
}: {
  licence: LicenceData;
  classifications: ClassificationReference[];
  today: string;
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // today comes from the server so this renders identically on both sides.
  const renewal = classifyRenewal(
    {
      id: licence.id,
      kind: "LICENSE",
      title: licence.licenseNumber,
      detail: licence.jurisdictionName,
      date: licence.expirationDate,
      expectsDate: true,
      href: "/settings",
      storedStatus: licence.status,
    },
    today,
  );

  function handleUpdate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCompanyLicense(licence.id, formData);
      if (result.ok) setIsEditing(false);
      else setError(result.error);
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCompanyLicense(licence.id);
      if (!result.ok) setError(result.error);
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form action={handleUpdate} className="flex flex-col gap-3">
          <LicenceFields licence={licence} classifications={classifications} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
            {error && <p className="text-sm text-rose-300">{error}</p>}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-100">
          {licence.jurisdictionName} — {licence.licenseNumber}
        </p>
        <p className="text-sm text-slate-400">
          {statusLabel(licence.status)}
          {licence.classificationCode && <> · {licence.classificationCode}</>}
          {licence.classificationLabel && <> {licence.classificationLabel}</>}
          {licence.bondNumber && <> · bond {licence.bondNumber}</>}
          {licence.expirationDate ? (
            <> · expires {licence.expirationDate}</>
          ) : (
            <> · no expiry recorded</>
          )}
        </p>
        {renewal.urgency === "EXPIRED" && (
          <p className="mt-0.5 text-xs font-medium text-red-400">{renewalTiming(renewal)}</p>
        )}
        {renewal.urgency === "DUE_SOON" && (
          <p className="mt-0.5 text-xs font-medium text-amber-400">{renewalTiming(renewal)}</p>
        )}
        {/* The one record here that stores a status AND a date, so the one
            that can contradict itself. Neither is corrected automatically. */}
        {renewal.disagreement && (
          <p className="mt-0.5 text-xs text-amber-300">{renewal.disagreement} Check which is right.</p>
        )}
        {error && !isEditing && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      </div>

      {canManage && (
        /* Arming the delete empties this row. "Edit" used to stay live beside
           the armed confirm — one click past where you meant to stop and you
           are editing the licence you were trying to leave alone — and Cancel
           now renders before the confirm, so a second click on the pixel the
           Delete button just vacated costs a click rather than the record.
           Both rules live in RowActions/ConfirmDelete rather than here. */
        <RowActions
          className="flex flex-wrap items-center gap-2"
          destructive={
            <ConfirmDelete
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={handleDelete}
              deleteClassName="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              cancelClassName="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          }
        >
          <button
            type="button"
            disabled={isPending}
            onClick={() => setIsEditing(true)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Edit
          </button>
        </RowActions>
      )}
    </li>
  );
}

export function CompanyLicenses({
  licences,
  classifications,
  today,
  canManage,
}: {
  licences: LicenceData[];
  classifications: ClassificationReference[];
  today: string;
  canManage: boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createCompanyLicense(formData);
      if (result.ok) setIsAdding(false);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {licences.length === 0 ? (
        <p className="text-sm text-slate-400">
          No licences recorded. Add the ones you hold and they&apos;ll appear in the renewals list on{" "}
          <span className="text-slate-300">Compliance</span> before they lapse.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {licences.map((licence) => (
            <LicenceRow
              key={licence.id}
              licence={licence}
              classifications={classifications}
              today={today}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      {canManage &&
        (isAdding ? (
          <form action={handleCreate} className="flex flex-col gap-3 rounded-lg border border-slate-800 p-4">
            <LicenceFields classifications={classifications} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isPending ? "Adding…" : "Add licence"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsAdding(false);
                  setError(null);
                }}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
              {error && <p className="text-sm text-rose-300">{error}</p>}
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="self-start rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Add a licence
          </button>
        ))}
    </div>
  );
}
