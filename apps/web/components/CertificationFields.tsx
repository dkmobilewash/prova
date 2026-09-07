"use client";

import { useState } from "react";
import { inputClass, labelClass } from "@/components/RfiFields";
import {
  CERTIFICATION_KINDS,
  CERTIFICATION_LABELS,
  type CertificationKindValue,
} from "@/lib/certifications";

export type WorkerOption = { id: string; label: string };

export type CertificationDefaults = {
  otherLabel: string | null;
  issuer: string | null;
  referenceNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  documentUrl: string | null;
  documentLabel: string | null;
};

/**
 * One card's fields, shared by the create form and the inline row edit so
 * the two cannot drift.
 *
 * The holder and kind selects only appear on create. Both are the identity
 * of the record — a card belongs to the person named on it — and the
 * action refuses to move either, so offering the control on an edit would
 * be offering something that does nothing.
 */
export function CertificationFields({
  defaults,
  workers,
  defaultWorkerId,
  lockedKind,
}: {
  defaults: CertificationDefaults;
  /** Create only. */
  workers?: WorkerOption[];
  defaultWorkerId?: string;
  /** Edit only: the kind already on the record, which decides whether the
   * OTHER label field is shown at all. */
  lockedKind?: CertificationKindValue;
}) {
  const [kind, setKind] = useState<string>(lockedKind ?? "");
  const showOtherLabel = kind === "OTHER";

  return (
    <>
      {workers && (
        <label className={labelClass}>
          Who holds it
          <select
            name="holderUserId"
            required
            defaultValue={defaultWorkerId ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              Choose someone on the team
            </option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            Whoever gets dispatched. Somebody who isn&apos;t on the team yet has to be invited on
            /team first — a card with nobody attached can&apos;t answer whether a crew is clear.
          </span>
        </label>
      )}

      {workers && (
        <label className={labelClass}>
          What it is
          <select
            name="kind"
            required
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Choose a certification
            </option>
            {CERTIFICATION_KINDS.map((option) => (
              <option key={option} value={option}>
                {CERTIFICATION_LABELS[option]}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            Locked once saved. Recording the wrong thing means deleting the row and entering it
            again — this log is read to establish who was qualified on a past date.
          </span>
        </label>
      )}

      {showOtherLabel && (
        <label className={labelClass}>
          Name it
          <input
            type="text"
            name="otherLabel"
            required
            defaultValue={defaults.otherLabel ?? ""}
            placeholder="e.g. Turner site orientation, Hilti firestop training"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            &ldquo;Other, expires in 12 days&rdquo; tells a foreman nothing he can act on.
          </span>
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Issued by
          <input
            type="text"
            name="issuer"
            defaultValue={defaults.issuer ?? ""}
            placeholder="e.g. Local 300 training centre"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Card / certificate number
          <input
            type="text"
            name="referenceNumber"
            defaultValue={defaults.referenceNumber ?? ""}
            placeholder="As printed on it"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date issued
          <input
            type="date"
            name="issuedOn"
            defaultValue={defaults.issuedOn ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            The date on the card, not today.
          </span>
        </label>
        <label className={labelClass}>
          Date it expires
          <input
            type="date"
            name="expiresOn"
            defaultValue={defaults.expiresOn ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Leave blank only if the card genuinely doesn&apos;t say. Blank is reported as{" "}
            <span className="text-amber-300">no expiry recorded</span> — never as current, because
            nobody can tell the two apart from an empty box.
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          placeholder="Restrictions, which GC asked for it, anything a reader would need."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Link to the scan
          <input
            type="url"
            name="documentUrl"
            defaultValue={defaults.documentUrl ?? ""}
            placeholder="https://…"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Wherever it lives — a shared drive, Procore, the GC&apos;s portal. A link, not an
            upload: a photo of a card is bigger than a Server Action can carry.
          </span>
        </label>
        <label className={labelClass}>
          Link label
          <input
            type="text"
            name="documentLabel"
            defaultValue={defaults.documentLabel ?? ""}
            placeholder="e.g. front and back scan"
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}
