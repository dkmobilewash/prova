"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmSubcontractInsurance,
  confirmSubcontractObligation,
  removeSubcontractInsurance,
  removeSubcontractObligation,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Spinner } from "@/components/Spinner";
import { COVERAGE_LABEL, COVERAGES, ENDORSEMENT_LABEL, ENDORSEMENTS } from "@/lib/subcontract-review/insurance";
import { obligationSentence } from "@/lib/subcontract-review/obligations";
import type { FollowThrough } from "@/lib/subcontract-review/query";

/**
 * Deadlines (which become alerts on the job) and insurance asks (stored for
 * the COI work), each PROPOSED from a finding and saved only when a person
 * presses Confirm — with every field editable first. Nothing here is saved by
 * a review run.
 */

const field = "min-h-12 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink";
const buttonClass =
  "min-h-12 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-60";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      after?.();
      router.refresh();
    });
  };
  return { error, isPending, run };
}

function ObligationForm({
  jobId,
  findingKey,
  initial,
  submitLabel,
}: {
  jobId: string;
  findingKey: string | null;
  initial: FollowThrough["proposedObligations"][number]["proposal"] | null;
  submitLabel: string;
}) {
  const { error, isPending, run } = useAction();
  const [kind, setKind] = useState(initial?.kind ?? "DATED");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        if (findingKey) formData.set("findingKey", findingKey);
        run(() => confirmSubcontractObligation(jobId, formData));
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Kind
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={field}>
          <option value="NOTICE_WINDOW">Notice window</option>
          <option value="MONTHLY_DAY">Every month</option>
          <option value="DATED">One date</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        What
        <input name="label" defaultValue={initial?.label ?? ""} required className={field} />
      </label>
      {kind === "NOTICE_WINDOW" && (
        <>
          <label className="flex w-24 flex-col gap-1 text-sm text-ink-label">
            Hours
            <input name="windowHours" inputMode="numeric" defaultValue={initial?.windowHours ?? ""} className={field} />
          </label>
          <label className="flex w-24 flex-col gap-1 text-sm text-ink-label">
            or days
            <input name="windowDays" inputMode="numeric" defaultValue={initial?.windowDays ?? ""} className={field} />
          </label>
        </>
      )}
      {kind === "MONTHLY_DAY" && (
        <label className="flex w-28 flex-col gap-1 text-sm text-ink-label">
          Day of month
          <input name="dayOfMonth" inputMode="numeric" defaultValue={initial?.dayOfMonth ?? ""} className={field} />
        </label>
      )}
      {kind === "DATED" && (
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Date
          <input type="date" name="dueOn" className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        To whom
        <input name="recipient" defaultValue={initial?.recipient ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        How
        <input name="form" defaultValue={initial?.form ?? ""} placeholder="e.g. in writing" className={`${field} placeholder:text-ink-muted`} />
      </label>
      <button type="submit" disabled={isPending} className={buttonClass}>
        {isPending ? <Spinner /> : submitLabel}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function InsuranceForm({
  jobId,
  findingKey,
  initial,
}: {
  jobId: string;
  findingKey: string;
  initial: FollowThrough["proposedInsurance"][number]["proposal"];
}) {
  const { error, isPending, run } = useAction();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        formData.set("findingKey", findingKey);
        run(() => confirmSubcontractInsurance(jobId, formData));
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Coverage
        <select name="coverage" defaultValue={initial.coverage} className={field}>
          {COVERAGES.map((coverage) => (
            <option key={coverage} value={coverage}>
              {COVERAGE_LABEL[coverage]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Per occurrence
        <input name="limitPerOccurrence" inputMode="decimal" defaultValue={initial.limitPerOccurrence ?? ""} className={`${field} w-36`} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Aggregate
        <input name="limitAggregate" inputMode="decimal" defaultValue={initial.limitAggregate ?? ""} className={`${field} w-36`} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Completed ops (years)
        <input name="completedOpsYears" inputMode="numeric" defaultValue={initial.completedOpsYears ?? ""} className={`${field} w-24`} />
      </label>
      <fieldset className="flex flex-wrap gap-3 text-sm text-ink-label">
        <legend className="sr-only">Endorsements</legend>
        {ENDORSEMENTS.map((endorsement) => (
          <label key={endorsement} className="flex min-h-12 items-center gap-2">
            <input
              type="checkbox"
              name="endorsements"
              value={endorsement}
              defaultChecked={initial.endorsements.includes(endorsement)}
              className="h-5 w-5"
            />
            {ENDORSEMENT_LABEL[endorsement]}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={isPending} className={buttonClass}>
        {isPending ? <Spinner /> : "Confirm"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function RemoveButton({ describe, onRemove }: { describe: string; onRemove: () => Promise<{ ok: boolean; error?: string }> }) {
  const { error, isPending, run } = useAction();
  return (
    <RowActions
      className="flex shrink-0 items-center gap-2"
      destructive={<ConfirmDelete label="Remove" confirmLabel="Remove it" pinned="end" describe={describe} pending={isPending} onConfirm={() => run(onRemove)} />}
    >
      {error && <span className="text-sm text-danger">{error}</span>}
    </RowActions>
  );
}

const money = (n: number | null) => (n === null ? null : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

export function SubcontractDeadlines({ jobId, followThrough }: { jobId: string; followThrough: FollowThrough }) {
  const { obligations, insurance, proposedObligations, proposedInsurance } = followThrough;
  return (
    <>
      <section className="mb-8 print:hidden" data-subcontract-review="deadlines">
        <h2 className="mb-1 text-lg font-semibold text-ink">Deadlines and notice windows</h2>
        <p className="mb-3 text-sm text-ink-body">
          Confirm a deadline and it shows on this job&apos;s alerts. A notice window is a rule rather than a date, so it
          stays on the job as a standing reminder.
        </p>
        {obligations.length > 0 && (
          <ul className="mb-3 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {obligations.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-subcontract-obligation={row.id}>
                <span className="text-ink">
                  {obligationSentence(row)}
                  {row.kind === "MONTHLY_DAY" && row.dayOfMonth && ` Every month on day ${row.dayOfMonth}.`}
                  {row.kind === "DATED" && row.dueOn && ` Due ${row.dueOn}.`}
                  {row.pageStart && <span className="ml-1 text-xs text-ink-muted">(p. {row.pageStart})</span>}
                </span>
                <RemoveButton
                  describe="Removes this deadline and its alert. The finding it came from stays on the review."
                  onRemove={() => removeSubcontractObligation(row.id)}
                />
              </li>
            ))}
          </ul>
        )}
        {proposedObligations.map((item) => (
          <div key={item.findingKey} className="mb-3 rounded-lg border border-line-card bg-surface p-4" data-subcontract-proposed-obligation={item.findingKey}>
            <p className="mb-2 text-sm italic text-ink-body">
              “{item.quote}” <span className="not-italic text-xs text-ink-muted">p. {item.pageStart}</span>
            </p>
            <ObligationForm jobId={jobId} findingKey={item.findingKey} initial={item.proposal} submitLabel="Confirm" />
          </div>
        ))}
        <details className="rounded-lg border border-line-card bg-surface p-4">
          <summary className="min-h-12 cursor-pointer text-sm font-medium text-ink-label">Add a deadline by hand</summary>
          <div className="mt-3">
            <ObligationForm jobId={jobId} findingKey={null} initial={null} submitLabel="Add" />
          </div>
        </details>
      </section>

      <section className="mb-8 print:hidden" data-subcontract-review="insurance">
        <h2 className="mb-1 text-lg font-semibold text-ink">Insurance asks</h2>
        <p className="mb-3 text-sm text-ink-body">
          What the subcontract requires you to carry, kept as a checklist for your certificates. Confirm each one after
          checking it against the clause.
        </p>
        {insurance.length > 0 && (
          <ul className="mb-3 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {insurance.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-subcontract-insurance={row.id}>
                <span className="text-ink">
                  {COVERAGE_LABEL[row.coverage as keyof typeof COVERAGE_LABEL] ?? row.coverage}
                  {row.coverageLabel && ` (${row.coverageLabel})`}
                  {row.limitPerOccurrence !== null && ` · ${money(row.limitPerOccurrence)} per occurrence`}
                  {row.limitAggregate !== null && ` · ${money(row.limitAggregate)} aggregate`}
                  {row.completedOpsYears !== null && ` · completed ops ${row.completedOpsYears} yrs`}
                  {row.endorsements.length > 0 &&
                    ` · ${row.endorsements.map((e) => ENDORSEMENT_LABEL[e as keyof typeof ENDORSEMENT_LABEL] ?? e).join(", ")}`}
                </span>
                <RemoveButton
                  describe="Removes this requirement from the checklist. The finding it came from stays on the review."
                  onRemove={() => removeSubcontractInsurance(row.id)}
                />
              </li>
            ))}
          </ul>
        )}
        {proposedInsurance.map((item) => (
          <div key={item.findingKey} className="mb-3 rounded-lg border border-line-card bg-surface p-4" data-subcontract-proposed-insurance={item.findingKey}>
            <p className="mb-2 text-sm italic text-ink-body">
              “{item.quote}” <span className="not-italic text-xs text-ink-muted">p. {item.pageStart}</span>
            </p>
            <InsuranceForm jobId={jobId} findingKey={item.findingKey} initial={item.proposal} />
          </div>
        ))}
        {insurance.length === 0 && proposedInsurance.length === 0 && (
          <p className="text-sm text-ink-muted">The review found no insurance requirements in the readable pages.</p>
        )}
      </section>
    </>
  );
}
