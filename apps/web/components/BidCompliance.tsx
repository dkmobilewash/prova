"use client";

import { useState, useTransition } from "react";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  acknowledgeBidAddendum,
  deleteBidAddendum,
  deleteBidRequirement,
  satisfyBidRequirement,
  saveBidAddendum,
  saveBidRequirement,
} from "@/lib/actions";
import {
  bidResponsiveness,
  responsivenessSentence,
  type AddendumInput,
  type RequirementInput,
  type ResponsivenessLine,
} from "@/lib/bid-responsiveness";

/**
 * What would get this bid thrown out before anybody reads the number.
 *
 * THE OUTSTANDING LIST IS ABOVE THE ROWS, for the same reason the levelling
 * caution sits above the quotes: it is the thing that decides whether the
 * work below it counts for anything. And nothing on this panel ever reads
 * "ready" — see `lib/bid-responsiveness.ts`, which has no such verdict to
 * give. The app has not read the GC's ITB; it has read what somebody typed
 * in from it, and on a document submitted once that difference is the bid.
 */

export type AddendumRow = AddendumInput & { notes: string | null };
export type RequirementRow = RequirementInput & { notes: string | null };

const KIND_LABELS: Record<string, string> = {
  BID_BOND: "Bid bond",
  SIGNED_BID_FORM: "Signed bid form",
  SUBCONTRACTOR_LIST: "Subcontractor list",
  INSURANCE_CERTIFICATE: "Insurance certificate",
  PREQUALIFICATION: "Prequalification",
  PARTICIPATION_FORMS: "Participation forms",
  OTHER: "Other",
};

export function BidCompliance({
  bidInvitationId,
  addenda,
  requirements,
  lines,
  today,
}: {
  bidInvitationId: string;
  addenda: AddendumRow[];
  requirements: RequirementRow[];
  /** Read-only here: the bid lines drive the derived half of the checks. */
  lines: ResponsivenessLine[];
  /** The reader's calendar day, resolved on the server — the date a one-tap
   * acknowledgement records. */
  today: string;
}) {
  const [adding, setAdding] = useState<null | "addendum" | "requirement">(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const result = bidResponsiveness({ lines, addenda, requirements });

  const run = (work: () => Promise<{ ok: boolean; error?: string } | void>) => {
    setRowError(null);
    startTransition(async () => {
      const outcome = await work();
      if (outcome && !outcome.ok) setRowError(outcome.error ?? "That didn't go through. Reload the page.");
    });
  };

  const stamp = (id: string, action: typeof acknowledgeBidAddendum, date: string) => {
    const formData = new FormData();
    formData.set(action === acknowledgeBidAddendum ? "acknowledgedOn" : "satisfiedOn", date);
    run(() => action(id, formData));
  };

  const nothingYet = addenda.length === 0 && requirements.length === 0;
  if (nothingYet && adding === null) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAdding("addendum")}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Log an addendum
        </button>
        <button
          type="button"
          onClick={() => setAdding("requirement")}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Add a bid-form requirement
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-line-row bg-surface-card p-3">
      {/* THE VERDICT, ABOVE EVERYTHING. */}
      <p
        className={`text-xs ${
          result.blockingCount > 0 ? "text-tag-rose-ink" : "text-ink-muted"
        }`}
      >
        {responsivenessSentence(result)}
      </p>

      {result.outstanding.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs">
          {result.outstanding.map((item) => (
            <li
              key={item.key}
              className={item.blocking ? "text-tag-amber-ink" : "text-ink-muted"}
            >
              {item.sentence}
            </li>
          ))}
        </ul>
      )}

      {/* A NUMBER THAT MAY NOW BE WRONG is a different problem from a form
          that is not filled in, so it is said separately. */}
      {result.repriceWarnings.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-tag-amber-ink">
          {result.repriceWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {addenda.length > 0 && (
        <section className="mt-3">
          <h4 className="text-sm font-semibold text-ink">Addenda</h4>
          <ul className="mt-1 flex flex-col divide-y divide-line-row">
            {addenda.map((row) =>
              editing === row.id ? (
                <li key={row.id} className="py-2">
                  <AddendumForm
                    bidInvitationId={bidInvitationId}
                    addendum={row}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-body">
                      <span className="font-medium text-ink">{row.reference}</span>
                      {row.issuedOn && <span className="ml-2 text-xs text-ink-muted">issued {row.issuedOn}</span>}
                      <span
                        className={`ml-2 text-xs ${
                          row.acknowledgedOn ? "text-tag-emerald-ink" : "text-tag-rose-ink"
                        }`}
                      >
                        {row.acknowledgedOn ? `acknowledged ${row.acknowledgedOn}` : "not acknowledged"}
                      </span>
                    </p>
                    {row.affectsPricedScope && (
                      <p className="mt-1 text-xs text-tag-amber-ink">
                        Changed work already priced{row.impactNote ? ` — ${row.impactNote}` : ""}
                      </p>
                    )}
                    {row.notes && <p className="mt-1 text-xs text-ink-muted">{row.notes}</p>}
                  </div>

                  <RowActions
                    className="flex shrink-0 items-center gap-2"
                    destructive={
                      <ConfirmDelete
                        label="Delete"
                        describe={`Removes ${row.reference} from this bid. The GC still issued it.`}
                        confirmLabel="Confirm delete"
                        pendingLabel="Deleting…"
                        pending={isPending}
                        pinned="end"
                        onConfirm={() => run(() => deleteBidAddendum(row.id))}
                      />
                    }
                  >
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => stamp(row.id, acknowledgeBidAddendum, row.acknowledgedOn ? "" : today)}
                      className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-60"
                    >
                      {row.acknowledgedOn ? "Un-acknowledge" : "Acknowledge"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(row.id)}
                      className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
                    >
                      Edit
                    </button>
                  </RowActions>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {requirements.length > 0 && (
        <section className="mt-3">
          <h4 className="text-sm font-semibold text-ink">What the bid form asks for</h4>
          <ul className="mt-1 flex flex-col divide-y divide-line-row">
            {requirements.map((row) =>
              editing === row.id ? (
                <li key={row.id} className="py-2">
                  <RequirementForm
                    bidInvitationId={bidInvitationId}
                    requirement={row}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-body">
                      <span className="font-medium text-ink">{row.label}</span>
                      <span className="ml-2 text-xs text-ink-muted">{KIND_LABELS[row.kind] ?? row.kind}</span>
                      {!row.required && <span className="ml-2 text-xs text-ink-muted">optional</span>}
                      <span
                        className={`ml-2 text-xs ${
                          row.satisfiedOn ? "text-tag-emerald-ink" : "text-tag-rose-ink"
                        }`}
                      >
                        {row.satisfiedOn ? `done ${row.satisfiedOn}` : "outstanding"}
                      </span>
                    </p>
                    {row.notes && <p className="mt-1 text-xs text-ink-muted">{row.notes}</p>}
                  </div>

                  <RowActions
                    className="flex shrink-0 items-center gap-2"
                    destructive={
                      <ConfirmDelete
                        label="Delete"
                        describe={`Removes "${row.label}" from this bid's checklist. The GC still wants it.`}
                        confirmLabel="Confirm delete"
                        pendingLabel="Deleting…"
                        pending={isPending}
                        pinned="end"
                        onConfirm={() => run(() => deleteBidRequirement(row.id))}
                      />
                    }
                  >
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => stamp(row.id, satisfyBidRequirement, row.satisfiedOn ? "" : today)}
                      className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-60"
                    >
                      {row.satisfiedOn ? "Not done after all" : "Mark done"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(row.id)}
                      className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
                    >
                      Edit
                    </button>
                  </RowActions>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {rowError && (
        <p role="alert" className="mt-2 text-sm text-tag-rose-ink">
          {rowError}
        </p>
      )}

      {adding === "addendum" ? (
        <div className="mt-3 border-t border-line-row pt-3">
          <AddendumForm bidInvitationId={bidInvitationId} addendum={null} onDone={() => setAdding(null)} />
        </div>
      ) : adding === "requirement" ? (
        <div className="mt-3 border-t border-line-row pt-3">
          <RequirementForm bidInvitationId={bidInvitationId} requirement={null} onDone={() => setAdding(null)} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAdding("addendum")}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
          >
            Log an addendum
          </button>
          <button
            type="button"
            onClick={() => setAdding("requirement")}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
          >
            Add a bid-form requirement
          </button>
        </div>
      )}
    </div>
  );
}

const inputClass =
  "rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body";
const labelClass = "flex flex-col gap-1 text-xs text-ink-label";

function AddendumForm({
  bidInvitationId,
  addendum,
  onDone,
}: {
  bidInvitationId: string;
  addendum: AddendumRow | null;
  onDone: () => void;
}) {
  return (
    <ActionForm
      action={saveBidAddendum.bind(null, bidInvitationId)}
      className="flex flex-wrap items-start gap-2"
      onSuccess={onDone}
    >
      {addendum && <input type="hidden" name="addendumId" value={addendum.id} />}

      <label className={labelClass}>
        What the GC called it
        <input
          name="reference"
          defaultValue={addendum?.reference ?? ""}
          placeholder="Addendum 3"
          className={`w-40 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Issued on
        <input type="date" name="issuedOn" defaultValue={addendum?.issuedOn ?? ""} className={inputClass} />
      </label>

      <label className={labelClass}>
        Acknowledged on
        <input
          type="date"
          name="acknowledgedOn"
          defaultValue={addendum?.acknowledgedOn ?? ""}
          className={inputClass}
        />
        <span className="text-ink-muted">Blank means not acknowledged.</span>
      </label>

      <label className="flex items-center gap-2 pt-5 text-xs text-ink-label">
        <input
          type="checkbox"
          name="affectsPricedScope"
          defaultChecked={addendum?.affectsPricedScope ?? false}
          className="h-4 w-4"
        />
        Changed work we had already priced
      </label>

      <label className={labelClass}>
        What it changed
        <input
          name="impactNote"
          defaultValue={addendum?.impactNote ?? ""}
          placeholder="soffit detail at grid C"
          className={`w-56 ${inputClass}`}
        />
      </label>

      <SubmitButton
        type="submit"
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {addendum ? "Save" : "Log addendum"}
      </SubmitButton>
      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

function RequirementForm({
  bidInvitationId,
  requirement,
  onDone,
}: {
  bidInvitationId: string;
  requirement: RequirementRow | null;
  onDone: () => void;
}) {
  return (
    <ActionForm
      action={saveBidRequirement.bind(null, bidInvitationId)}
      className="flex flex-wrap items-start gap-2"
      onSuccess={onDone}
    >
      {requirement && <input type="hidden" name="requirementId" value={requirement.id} />}

      <label className={labelClass}>
        Kind
        <select name="kind" defaultValue={requirement?.kind ?? "BID_BOND"} className={`w-44 ${inputClass}`}>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        As the bid form words it
        <input
          name="label"
          defaultValue={requirement?.label ?? ""}
          placeholder="Bid bond, 10% of base bid"
          className={`w-64 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Done on
        <input
          type="date"
          name="satisfiedOn"
          defaultValue={requirement?.satisfiedOn ?? ""}
          className={inputClass}
        />
        <span className="text-ink-muted">Blank means outstanding.</span>
      </label>

      <label className="flex items-center gap-2 pt-5 text-xs text-ink-label">
        {/* Checked by default, and posted as "off" when cleared — the action
            reads `!== "off"`, so an unchecked box has to send something. */}
        <input type="checkbox" name="required" value="on" defaultChecked={requirement?.required ?? true} className="h-4 w-4" />
        Required (not optional)
      </label>

      <SubmitButton
        type="submit"
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {requirement ? "Save" : "Add requirement"}
      </SubmitButton>
      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
