"use client";

import { useState, useTransition } from "react";
import {
  approveChangeOrder,
  createChangeOrder,
  deleteChangeOrderDraft,
  proposeAddedScope,
  proposeLineItemChange,
  proposeScopeRemoval,
  rejectChangeOrder,
  removeProposal,
  reopenChangeOrder,
  reviseChangeOrder,
  submitChangeOrder,
  voidChangeOrder,
} from "@/lib/actions";
import { TRADE_SCOPES, type ActionResult } from "@/lib/actions/shared";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";
const primaryBtn =
  "rounded-md bg-brand px-3 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Runs a Server Action that returns `{ ok, error }`, and renders the error.
 *
 * #105 finding 8: all twelve change-order actions used to throw, and
 * production redacts a thrown Server Action message to a digest — so every
 * PM-facing "what to do next" sentence ("CO #3 has already been sent — void
 * it and raise a new one") reached a real user as a reference number. They
 * return their failures now, which only matters if something here actually
 * reads the return value — a plain `<form action={fn}>` throws it away, so
 * every form in this file calls its action from `onSubmit` instead. Same
 * shape as `components/SubmittalRow.tsx` and `SubmittalForm.tsx`, this
 * repo's reference for an ActionResult-returning form.
 */
function useActionRunner() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  return { isPending, error, setError, run };
}

export type ProposalView = {
  id: string;
  changeType: "ADD" | "EDIT" | "REMOVE";
  targetDescription: string | null;
  summary: string;
};

export type ChangeOrderView = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "VOID";
  submittedOn: string | null;
  decidedOn: string | null;
  decisionNotes: string | null;
  /** Signed contract-value delta, formatted. */
  valueDelta: string;
  /** Empty when this change order can be reopened; otherwise the reasons it
   * can't, ready to show without the user having to click and get an error. */
  reopenBlockers: string[];
  reopenedAt: string | null;
  reopenNote: string | null;
  /** "CO #3", when this change order was raised to correct one. */
  supersedesLabel: string | null;
  /** "CO #7", when a later change order corrects this one. */
  revisedByLabels: string[];
  proposals: ProposalView[];
  edits: { id: string; field: string; oldValue: string; newValue: string }[];
};

export type LineItemChoice = { id: string; description: string };

/** Rendered in UTC — the stored value is UTC midnight, so local rendering
 * would show the previous day for anyone west of UTC. */
function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The audit log stores the schema's field name and raw values. Neither is
 * something to put in front of a PM. */
const EDIT_FIELD_LABEL: Record<string, string> = {
  quantity: "Quantity",
  unitPrice: "Unit price",
  deleted: "Removed from the contract",
};

function formatEditValue(field: string, value: string) {
  if (field === "deleted") return value === "true" ? "yes" : "no";
  if (value === "(none)") return "none";
  if (field === "unitPrice") {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? parsed.toLocaleString("en-US", { style: "currency", currency: "USD" })
      : value;
  }
  return value;
}

const STATUS_STYLE: Record<ChangeOrderView["status"], string> = {
  DRAFT: "border-neutral-400 bg-neutral-100 text-ink-label",
  SUBMITTED: "border-amber-600 bg-tag-amber text-tag-amber-ink",
  APPROVED: "border-emerald-700 bg-tag-green text-tag-green-ink",
  REJECTED: "border-rose-700 bg-tag-rose text-tag-rose-ink",
  VOID: "border-line-card bg-surface text-ink-muted",
};

const STATUS_LABEL: Record<ChangeOrderView["status"], string> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending GC",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  VOID: "Withdrawn",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ProposalForms({ changeOrder, lineItems }: { changeOrder: ChangeOrderView; lineItems: LineItemChoice[] }) {
  const [kind, setKind] = useState<"ADD" | "EDIT" | "REMOVE">("ADD");
  const { isPending, error, run } = useActionRunner();

  function submit(event: React.FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<ActionResult>) {
    event.preventDefault();
    // Captured synchronously, before the async run() below: a SyntheticEvent
    // does not stay valid for the life of an await, so the form reference has
    // to be taken now rather than read off `event` again inside the callback.
    const form = event.currentTarget;
    const formData = new FormData(form);
    run(() => action(formData), () => form.reset());
  }

  return (
    <div className="mt-3 rounded-md border border-line-row bg-canvas p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        {(["ADD", "EDIT", "REMOVE"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md border px-3 py-1 text-xs ${
              kind === k
                ? "border-brand bg-tag-brand-soft text-tag-brand-soft-ink"
                : "border-line-card bg-surface text-ink-body hover:text-ink-label"
            }`}
          >
            {k === "ADD" ? "Add scope" : k === "EDIT" ? "Change a line" : "Remove a line"}
          </button>
        ))}
      </div>

      {kind === "ADD" && (
        <form
          onSubmit={(event) => submit(event, (formData) => proposeAddedScope(changeOrder.id, formData))}
          className="flex flex-wrap items-end gap-3"
        >
          <label className={labelClass}>
            Description
            <input name="itemDescription" required className={`${inputClass} w-56`} placeholder="Tile backsplash" />
          </label>
          <label className={labelClass}>
            Unit
            <input name="unit" className={`${inputClass} w-20`} placeholder="SF" />
          </label>
          <label className={labelClass}>
            Qty
            <input name="quantity" type="number" step="0.01" defaultValue="1" required className={`${inputClass} w-24`} />
          </label>
          <label className={labelClass}>
            Unit price
            <input name="unitPrice" type="number" step="0.01" className={`${inputClass} w-28`} />
          </label>
          <label className={labelClass}>
            Budgeted unit cost
            <input name="budgetedUnitCost" type="number" step="0.01" className={`${inputClass} w-32`} />
          </label>
          <label className={labelClass}>
            Trade scope
            <select name="tradeScope" className={`${inputClass} w-48`} defaultValue="">
              <option value="">—</option>
              {TRADE_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isPending} className={primaryBtn}>
            {isPending ? "Adding…" : "Add to CO"}
          </button>
          {error && <p className="w-full text-xs text-tag-rose-ink">{error}</p>}
        </form>
      )}

      {kind === "EDIT" && (
        <form
          onSubmit={(event) => submit(event, (formData) => proposeLineItemChange(changeOrder.id, formData))}
          className="flex flex-wrap items-end gap-3"
        >
          <label className={labelClass}>
            Line item
            <select name="lineItemId" required className={`${inputClass} w-64`}>
              {lineItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            New qty
            <input name="quantity" type="number" step="0.01" className={`${inputClass} w-24`} />
          </label>
          <label className={labelClass}>
            New unit price
            <input name="unitPrice" type="number" step="0.01" className={`${inputClass} w-28`} />
          </label>
          <button type="submit" disabled={isPending} className={primaryBtn}>
            {isPending ? "Adding…" : "Add to CO"}
          </button>
          <p className="w-full text-xs text-ink-muted">Leave a field blank to leave it unchanged.</p>
          {error && <p className="w-full text-xs text-tag-rose-ink">{error}</p>}
        </form>
      )}

      {kind === "REMOVE" && (
        <form
          onSubmit={(event) => submit(event, (formData) => proposeScopeRemoval(changeOrder.id, formData))}
          className="flex flex-wrap items-end gap-3"
        >
          <label className={labelClass}>
            Line item to remove
            <select name="lineItemId" required className={`${inputClass} w-64`}>
              {lineItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isPending} className={primaryBtn}>
            {isPending ? "Adding…" : "Add to CO"}
          </button>
          {error && <p className="w-full text-xs text-tag-rose-ink">{error}</p>}
        </form>
      )}
    </div>
  );
}

function Decision({ changeOrder }: { changeOrder: ChangeOrderView }) {
  const approve = useActionRunner();
  const reject = useActionRunner();
  const void_ = useActionRunner();

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-line-row bg-canvas p-3">
      <p className="text-xs text-ink-muted">
        Sent to the GC {formatDate(changeOrder.submittedOn)}. Approving writes this scope into the
        budget; rejecting keeps the record without touching it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            approve.run(() => approveChangeOrder(changeOrder.id, formData));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className={labelClass}>
            Decision date
            <input name="decidedOn" type="date" defaultValue={today()} className={`${inputClass} w-40`} />
          </label>
          <label className={labelClass}>
            GC notes
            <input name="decisionNotes" className={`${inputClass} w-56`} placeholder="Approved per PM email" />
          </label>
          <button
            type="submit"
            disabled={approve.isPending}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approve.isPending ? "Approving…" : "Approve"}
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            reject.run(() => rejectChangeOrder(changeOrder.id, formData));
          }}
          className="flex items-end gap-2"
        >
          <input type="hidden" name="decidedOn" value={today()} />
          <button
            type="submit"
            disabled={reject.isPending}
            className="rounded-md border border-rose-700 px-3 py-2 text-sm font-medium text-tag-rose-ink hover:bg-tag-rose disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reject.isPending ? "Rejecting…" : "Reject"}
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            void_.run(() => voidChangeOrder(changeOrder.id, formData));
          }}
          className="flex items-end gap-2"
        >
          <input type="hidden" name="decidedOn" value={today()} />
          <button
            type="submit"
            disabled={void_.isPending}
            className="rounded-md border border-line-card px-3 py-2 text-sm text-ink-body hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {void_.isPending ? "Withdrawing…" : "Withdraw"}
          </button>
        </form>
      </div>
      {(approve.error || reject.error || void_.error) && (
        <p className="text-xs text-tag-rose-ink">{approve.error || reject.error || void_.error}</p>
      )}
    </div>
  );
}

/**
 * How an approved change order gets corrected.
 *
 * Reopening unwinds it back to a draft, but only while its scope is
 * untouched. Once anything has been costed or billed against it — or once a
 * later approved change order has since touched the same lines (#105
 * finding 1) — unwinding would leave the contract value contradicting
 * something already sent to the GC, so the blockers are shown up front
 * rather than after a failed click.
 */
function Correction({ changeOrder }: { changeOrder: ChangeOrderView }) {
  const canReopen = changeOrder.reopenBlockers.length === 0;
  const reopen = useActionRunner();
  const revise = useActionRunner();

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-line-row bg-canvas p-3">
      {canReopen ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            reopen.run(() => reopenChangeOrder(changeOrder.id, formData));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className={labelClass}>
            Reopen to correct it
            <input name="reopenNote" className={`${inputClass} w-64`} placeholder="Priced at the wrong rate" />
          </label>
          <button
            type="submit"
            disabled={reopen.isPending}
            className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-tag-amber-ink hover:bg-tag-amber disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reopen.isPending ? "Reopening…" : "Reopen"}
          </button>
          <p className="w-full text-xs text-ink-muted">
            Takes this change order back to a draft and undoes its effect on the contract value. Nothing
            depends on what it changed, so there is nothing to break — reversing an edit restores the
            previous values and leaves any costs or hours on that line untouched.
          </p>
          {reopen.error && <p className="w-full text-xs text-tag-rose-ink">{reopen.error}</p>}
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-tag-amber-ink">
            This change order can no longer be reopened: {changeOrder.reopenBlockers.join("; ")}. Revising it
            corrects the scope without contradicting what has already been costed or billed.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              revise.run(() => reviseChangeOrder(changeOrder.id, formData));
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className={labelClass}>
              Raise a revision
              <input
                name="title"
                className={`${inputClass} w-64`}
                placeholder={`Revision of CO #${changeOrder.number}`}
              />
            </label>
            <button type="submit" disabled={revise.isPending} className={primaryBtn}>
              {revise.isPending ? "Raising…" : "Revise"}
            </button>
            {revise.error && <p className="w-full text-xs text-tag-rose-ink">{revise.error}</p>}
          </form>
        </div>
      )}
    </div>
  );
}

function ProposalRow({ proposal, canRemove }: { proposal: ProposalView; canRemove: boolean }) {
  const { isPending, error, run } = useActionRunner();

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-sm text-ink-body">
        <span>
          <span className="text-ink-muted">{proposal.changeType.toLowerCase()}</span> {proposal.summary}
        </span>
        {canRemove && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => removeProposal(proposal.id))}
            className="text-xs text-ink-muted hover:text-rose-600 disabled:opacity-50"
          >
            {isPending ? "removing…" : "remove"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-tag-rose-ink">{error}</p>}
    </li>
  );
}

function DraftActions({ changeOrder }: { changeOrder: ChangeOrderView }) {
  const submit = useActionRunner();
  const discard = useActionRunner();

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          submit.run(() => submitChangeOrder(changeOrder.id, formData));
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className={labelClass}>
          Date sent to GC
          <input name="submittedOn" type="date" defaultValue={today()} className={`${inputClass} w-40`} />
        </label>
        <button
          type="submit"
          disabled={submit.isPending || changeOrder.proposals.length === 0}
          className={primaryBtn}
        >
          {submit.isPending ? "Sending…" : "Send to GC"}
        </button>
        {submit.error && <p className="w-full text-xs text-tag-rose-ink">{submit.error}</p>}
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          discard.run(() => deleteChangeOrderDraft(changeOrder.id));
        }}
      >
        <button
          type="submit"
          disabled={discard.isPending}
          className="rounded-md border border-line-card px-3 py-2 text-sm text-ink-body hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {discard.isPending ? "Discarding…" : "Discard draft"}
        </button>
        {discard.error && <p className="mt-1 text-xs text-tag-rose-ink">{discard.error}</p>}
      </form>
    </div>
  );
}

export function ChangeOrders({
  jobId,
  changeOrders,
  lineItems,
  pendingExposure,
  pendingUnbookable,
}: {
  jobId: string;
  changeOrders: ChangeOrderView[];
  lineItems: LineItemChoice[];
  pendingExposure: string;
  /** How many pending proposals target scope that's already been removed by
   * another approved change order, and so can never actually be booked
   * (#105 finding 5) — reported so the exposure figure reads as a floor
   * rather than a silently-shrunk total. */
  pendingUnbookable?: number;
}) {
  const pendingCount = changeOrders.filter((co) => co.status === "SUBMITTED").length;
  const create = useActionRunner();

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Change orders</h2>
        {pendingCount > 0 && (
          <p className="text-sm text-tag-amber-ink">
            {pendingCount} pending with the GC · {pendingExposure} not in the contract value
            {!!pendingUnbookable && pendingUnbookable > 0 && (
              <span className="text-ink-muted">
                {" "}
                ({pendingUnbookable} of the pending {pendingUnbookable === 1 ? "change targets" : "changes target"}{" "}
                scope already removed elsewhere and can&apos;t be booked)
              </span>
            )}
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          create.run(() => createChangeOrder(jobId, formData), () => form.reset());
        }}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-line-card bg-surface p-3"
      >
        <label className={labelClass}>
          New change order
          <input name="title" required className={`${inputClass} w-64`} placeholder="Add tile backsplash" />
        </label>
        <label className={labelClass}>
          Notes
          <input name="description" className={`${inputClass} w-64`} />
        </label>
        <button type="submit" disabled={create.isPending} className={primaryBtn}>
          {create.isPending ? "Starting…" : "Start draft"}
        </button>
        <p className="w-full text-xs text-ink-muted">
          A draft changes nothing until the GC approves it — the contract value only moves on approval.
        </p>
        {create.error && <p className="w-full text-xs text-tag-rose-ink">{create.error}</p>}
      </form>

      {changeOrders.length === 0 ? (
        <div className="rounded-md border border-line-card bg-surface p-4 text-sm text-ink-body">
          No change orders on this job yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {changeOrders.map((co) => (
            <li key={co.id} className="rounded-md border border-line-card bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">
                  CO #{co.number}: {co.title}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums text-ink-label">{co.valueDelta}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[co.status]}`}>
                    {STATUS_LABEL[co.status]}
                  </span>
                </div>
              </div>
              {co.description && <p className="mt-1 text-sm text-ink-body">{co.description}</p>}

              {co.supersedesLabel && (
                <p className="mt-1 text-xs text-tag-blue-ink">Raised to correct {co.supersedesLabel}.</p>
              )}
              {co.revisedByLabels.length > 0 && (
                <p className="mt-1 text-xs text-tag-blue-ink">
                  Corrected by {co.revisedByLabels.join(", ")}. This one stayed approved — it did move the
                  contract value at the time.
                </p>
              )}
              {co.reopenedAt && (
                <p className="mt-1 text-xs text-tag-amber-ink">
                  Approved, then reopened on {formatDate(co.reopenedAt)}
                  {co.reopenNote ? `: "${co.reopenNote}"` : ""}.
                </p>
              )}

              <p className="mt-1 text-xs text-ink-muted">
                {co.status === "DRAFT"
                  ? "Not sent yet."
                  : `Sent ${formatDate(co.submittedOn)}${
                      co.decidedOn ? ` · answered ${formatDate(co.decidedOn)}` : " · awaiting a decision"
                    }`}
                {co.decisionNotes ? ` · "${co.decisionNotes}"` : ""}
              </p>

              {co.proposals.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {co.proposals.map((proposal) => (
                    <ProposalRow key={proposal.id} proposal={proposal} canRemove={co.status === "DRAFT"} />
                  ))}
                </ul>
              )}

              {/* Audit trail of what actually landed, written on approval. */}
              {co.edits.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5">
                  {co.edits.map((edit) => (
                    <li key={edit.id} className="text-xs text-ink-muted">
                      {EDIT_FIELD_LABEL[edit.field] ?? edit.field}:{" "}
                      {formatEditValue(edit.field, edit.oldValue)} →{" "}
                      {formatEditValue(edit.field, edit.newValue)}
                    </li>
                  ))}
                </ul>
              )}

              {co.status === "DRAFT" && (
                <>
                  <ProposalForms changeOrder={co} lineItems={lineItems} />
                  <DraftActions changeOrder={co} />
                </>
              )}

              {co.status === "SUBMITTED" && <Decision changeOrder={co} />}

              {co.status === "APPROVED" && <Correction changeOrder={co} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
