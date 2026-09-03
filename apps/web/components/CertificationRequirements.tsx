"use client";

import { useRef, useState, useTransition } from "react";
import { addCertificationRequirement, removeCertificationRequirement } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import {
  CERTIFICATION_KINDS,
  CERTIFICATION_LABELS,
  certificationTitle,
  type RequirementRecord,
} from "@/lib/certifications";

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

/**
 * What the company requires of everyone, and the only control that turns a
 * blank into a finding.
 *
 * There is no inline edit here, unlike the certification rows above it: a
 * requirement IS its kind, so "editing" one to a different kind is
 * removing it and requiring the other thing. Only the note is otherwise
 * editable, and re-adding it is one click.
 */
export function CertificationRequirements({
  requirements,
  canRemove,
}: {
  requirements: RequirementRecord[];
  /** Owner-only, like every other destructive control in this app. A
   * member removing a requirement would silently clear findings off
   * everybody's row. */
  canRemove: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<string>("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {isOpen ? (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => addCertificationRequirement(formData),
              () => {
                formRef.current?.reset();
                setKind("");
                setIsOpen(false);
              },
            );
          }}
          className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-300">Require a certification</h3>
          <p className="text-xs text-slate-500">
            Everyone on the team is measured against this. A person with no record of it at all
            reads as <span className="text-red-300">nothing on file</span> rather than disappearing,
            which is the whole reason this control exists.
          </p>

          <label className={labelClass}>
            What everyone needs
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
          </label>

          {kind === "OTHER" && (
            <label className={labelClass}>
              Name it
              <input
                type="text"
                name="otherLabel"
                required
                placeholder="e.g. Turner site orientation"
                className={inputClass}
              />
            </label>
          )}

          <label className={labelClass}>
            Why
            <input
              type="text"
              name="notes"
              placeholder="Which GC asks for it, or the standard it comes from."
              className={inputClass}
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Require it"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            Require a certification
          </button>
        </div>
      )}

      {requirements.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing is required of everyone yet, so this page can only report on cards somebody has
          already entered — and the dangerous case is the opposite one. Require OSHA 10 and a
          respirator fit test to start; anyone with no record of either will say so by name.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {requirements.map((requirement) => (
            <li
              key={requirement.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-slate-100">
                  {certificationTitle(requirement.kind, requirement.otherLabel || null)}
                </p>
                {requirement.notes && (
                  <p className="text-xs text-slate-500">{requirement.notes}</p>
                )}
              </div>
              {canRemove &&
                (confirmingId === requirement.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => removeCertificationRequirement(requirement.id))}
                      className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {isPending ? "Removing…" : "Confirm remove"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setConfirmingId(null)}
                      className={btn}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setConfirmingId(requirement.id)}
                    className={btn}
                  >
                    Remove
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}

      {error && !isOpen && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
