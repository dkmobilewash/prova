"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  addProposalClauseToJob,
  createProposalClause,
  deleteProposalClause,
  removeProposalClause,
  updateProposalClause,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  PROPOSAL_CLAUSE_KINDS,
  PROPOSAL_CLAUSE_LABELS,
  type ProposalClauseKindValue,
} from "@/lib/proposal-clauses";

/**
 * The proposal clause forms — the library on /proposals and the builder on a
 * job's proposal.
 *
 * Every form here follows the house pattern (LogTimeEntryForm.tsx is the
 * reference): `onSubmit` + `preventDefault()` + `new FormData(currentTarget)`,
 * the returned `{ ok: false, error }` rendered beside the form, and the form
 * reset ONLY on success. A server-rendered `<form action={…}>` would discard
 * that returned sentence entirely, and a client `action` prop resets the form
 * before hearing whether the save worked (formActionCensus.test.ts).
 */

type Result = { ok: true } | { ok: false; error: string };

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const primary =
  "rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700 disabled:opacity-50";
const secondary =
  "rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800 disabled:opacity-50";

/** `resetOnSuccess` is false for an edit-in-place row: what was typed IS the
 * saved value, and resetting would snap the input back to the pre-save
 * default before the revalidated render lands. */
function useSubmit(run: (formData: FormData) => Promise<Result>, resetOnSuccess = true) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await run(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (resetOnSuccess) form.reset();
    });
  }

  return { isPending, error, onSubmit };
}

function KindSelect({ defaultValue }: { defaultValue: ProposalClauseKindValue }) {
  return (
    <select name="kind" defaultValue={defaultValue} className={field} aria-label="Kind">
      {PROPOSAL_CLAUSE_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {PROPOSAL_CLAUSE_LABELS[kind]}
        </option>
      ))}
    </select>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="w-full text-sm text-tag-amber-ink">{error}</p>;
}

/* ------------------------------------------------------------------ library */

/** Add a clause to the company library. */
export function NewProposalClauseForm() {
  const { isPending, error, onSubmit } = useSubmit((formData) => createProposalClause(formData));
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-line-card bg-surface p-4">
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Kind
        <KindSelect defaultValue="EXCLUSION" />
      </label>
      <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-sm text-ink-label">
        Text
        <input name="text" placeholder="Excluded: owner-furnished dumpsters" className={field} />
      </label>
      <button type="submit" disabled={isPending} className={primary}>
        {isPending ? "Adding…" : "Add clause"}
      </button>
      <ErrorLine error={error} />
    </form>
  );
}

/** One library clause: edit in place, remove in two steps (owner only). */
export function ProposalClauseRow({
  clause,
}: {
  clause: { id: string; kind: ProposalClauseKindValue; text: string };
}) {
  const save = useSubmit((formData) => updateProposalClause(clause.id, formData), false);
  const [isRemoving, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleRemove() {
    setRemoveError(null);
    startRemove(async () => {
      const result = await deleteProposalClause(clause.id);
      if (!result.ok) setRemoveError(result.error);
    });
  }

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <form onSubmit={save.onSubmit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <KindSelect defaultValue={clause.kind} />
        <input
          name="text"
          defaultValue={clause.text}
          aria-label="Clause text"
          className={`${field} min-w-[220px] flex-1`}
        />
        <button type="submit" disabled={save.isPending} className="rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium text-ink hover:bg-neutral-700 disabled:opacity-50">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <ErrorLine error={save.error} />
      </form>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <RowActions
          className="flex items-center justify-end gap-2"
          destructive={
            <ConfirmDelete
              pinned="end"
              describe="Takes this clause out of your library. Proposals that already include it keep their copy."
              label="Remove"
              confirmLabel="Remove it"
              pendingLabel="Removing…"
              pending={isRemoving}
              onConfirm={handleRemove}
            />
          }
        />
        {removeError && <p className="max-w-[16rem] text-right text-xs text-tag-amber-ink">{removeError}</p>}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------- job proposal */

/** Add a clause to one job's proposal, from the library or typed inline. */
export function JobProposalClauseBuilder({
  jobId,
  library,
}: {
  jobId: string;
  library: { id: string; kind: ProposalClauseKindValue; text: string }[];
}) {
  const fromLibrary = useSubmit((formData) => addProposalClauseToJob(jobId, formData));
  const inline = useSubmit((formData) => addProposalClauseToJob(jobId, formData));

  return (
    <div className="flex flex-col gap-4">
      {library.length > 0 ? (
        <form onSubmit={fromLibrary.onSubmit} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-sm text-ink-label">
            From your library
            <select name="clauseId" className={field}>
              {library.map((clause) => (
                <option key={clause.id} value={clause.id}>
                  {PROPOSAL_CLAUSE_LABELS[clause.kind]} — {clause.text}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={fromLibrary.isPending} className={secondary}>
            {fromLibrary.isPending ? "Adding…" : "Add from library"}
          </button>
          <ErrorLine error={fromLibrary.error} />
        </form>
      ) : (
        <p className="text-sm text-ink-body">
          Your clause library is empty. Clauses you repeat on every bid belong on{" "}
          <a href="/proposals" className="text-link hover:underline">
            Proposal clauses
          </a>
          ; for now, type this one below.
        </p>
      )}

      <form onSubmit={inline.onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Kind
          <KindSelect defaultValue="EXCLUSION" />
        </label>
        <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-sm text-ink-label">
          Or type one for this job only
          <input name="text" placeholder="Clarification: pricing assumes two mobilizations" className={field} />
        </label>
        <button type="submit" disabled={inline.isPending} className={primary}>
          {inline.isPending ? "Adding…" : "Add"}
        </button>
        <ErrorLine error={inline.error} />
      </form>
    </div>
  );
}

/** One clause on a job's proposal, removable in two steps. `children` is the
 * clause as it prints. */
export function JobProposalClauseRow({
  jobId,
  clauseId,
  children,
}: {
  jobId: string;
  clauseId: string;
  children: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeProposalClause(jobId, clauseId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    // The <li> stays display:list-item so the printed bullet survives; the
    // flex row lives inside it.
    <li className="mt-1">
      <span className="flex flex-wrap items-start justify-between gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      <span className="flex shrink-0 flex-col items-end gap-1 print:hidden">
        <RowActions
          as="span"
          className="flex items-center justify-end gap-2"
          destructive={
            <ConfirmDelete
              pinned="end"
              describe="Takes this clause off this job's proposal. Your library copy is not touched."
              label="Remove"
              confirmLabel="Remove it"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={handleRemove}
              deleteClassName="text-xs text-red-400 hover:underline"
            />
          }
        />
        {error && <span className="max-w-[16rem] text-right text-xs text-tag-amber-ink">{error}</span>}
      </span>
      </span>
    </li>
  );
}
