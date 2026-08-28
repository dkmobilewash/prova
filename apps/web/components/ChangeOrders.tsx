"use client";

import { useState } from "react";
import {
  approveChangeOrder,
  createChangeOrder,
  deleteChangeOrderDraft,
  proposeAddedScope,
  proposeLineItemChange,
  proposeScopeRemoval,
  rejectChangeOrder,
  removeProposal,
  submitChangeOrder,
  voidChangeOrder,
} from "@/lib/actions";
import { TRADE_SCOPES } from "@/lib/actions/shared";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

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

const STATUS_STYLE: Record<ChangeOrderView["status"], string> = {
  DRAFT: "border-slate-600 bg-slate-800 text-slate-300",
  SUBMITTED: "border-amber-600 bg-amber-950 text-amber-300",
  APPROVED: "border-emerald-700 bg-emerald-950 text-emerald-300",
  REJECTED: "border-rose-700 bg-rose-950 text-rose-300",
  VOID: "border-slate-700 bg-slate-900 text-slate-500",
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

  return (
    <div className="mt-3 rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        {(["ADD", "EDIT", "REMOVE"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md border px-3 py-1 text-xs ${
              kind === k
                ? "border-blue-500 bg-blue-950 text-blue-200"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            {k === "ADD" ? "Add scope" : k === "EDIT" ? "Change a line" : "Remove a line"}
          </button>
        ))}
      </div>

      {kind === "ADD" && (
        <form action={proposeAddedScope.bind(null, changeOrder.id)} className="flex flex-wrap items-end gap-3">
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
          <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
            Add to CO
          </button>
        </form>
      )}

      {kind === "EDIT" && (
        <form action={proposeLineItemChange.bind(null, changeOrder.id)} className="flex flex-wrap items-end gap-3">
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
          <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
            Add to CO
          </button>
          <p className="w-full text-xs text-slate-500">Leave a field blank to leave it unchanged.</p>
        </form>
      )}

      {kind === "REMOVE" && (
        <form action={proposeScopeRemoval.bind(null, changeOrder.id)} className="flex flex-wrap items-end gap-3">
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
          <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
            Add to CO
          </button>
        </form>
      )}
    </div>
  );
}

function Decision({ changeOrder }: { changeOrder: ChangeOrderView }) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs text-slate-500">
        Sent to the GC {formatDate(changeOrder.submittedOn)}. Approving writes this scope into the
        budget; rejecting keeps the record without touching it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <form action={approveChangeOrder.bind(null, changeOrder.id)} className="flex flex-wrap items-end gap-2">
          <label className={labelClass}>
            Decision date
            <input name="decidedOn" type="date" defaultValue={today()} className={`${inputClass} w-40`} />
          </label>
          <label className={labelClass}>
            GC notes
            <input name="decisionNotes" className={`${inputClass} w-56`} placeholder="Approved per PM email" />
          </label>
          <button className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            Approve
          </button>
        </form>
        <form action={rejectChangeOrder.bind(null, changeOrder.id)} className="flex items-end gap-2">
          <input type="hidden" name="decidedOn" value={today()} />
          <button className="rounded-md border border-rose-700 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-950">
            Reject
          </button>
        </form>
        <form action={voidChangeOrder.bind(null, changeOrder.id)} className="flex items-end gap-2">
          <input type="hidden" name="decidedOn" value={today()} />
          <button className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:bg-slate-800">
            Withdraw
          </button>
        </form>
      </div>
    </div>
  );
}

export function ChangeOrders({
  jobId,
  changeOrders,
  lineItems,
  pendingExposure,
}: {
  jobId: string;
  changeOrders: ChangeOrderView[];
  lineItems: LineItemChoice[];
  pendingExposure: string;
}) {
  const pendingCount = changeOrders.filter((co) => co.status === "SUBMITTED").length;

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Change orders</h2>
        {pendingCount > 0 && (
          <p className="text-sm text-amber-300">
            {pendingCount} pending with the GC · {pendingExposure} not in the contract value
          </p>
        )}
      </div>

      <form
        action={createChangeOrder.bind(null, jobId)}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-800 bg-slate-900 p-3"
      >
        <label className={labelClass}>
          New change order
          <input name="title" required className={`${inputClass} w-64`} placeholder="Add tile backsplash" />
        </label>
        <label className={labelClass}>
          Notes
          <input name="description" className={`${inputClass} w-64`} />
        </label>
        <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
          Start draft
        </button>
        <p className="w-full text-xs text-slate-500">
          A draft changes nothing until the GC approves it — the contract value only moves on approval.
        </p>
      </form>

      {changeOrders.length === 0 ? (
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          No change orders on this job yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {changeOrders.map((co) => (
            <li key={co.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-100">
                  CO #{co.number}: {co.title}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums text-slate-300">{co.valueDelta}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[co.status]}`}>
                    {STATUS_LABEL[co.status]}
                  </span>
                </div>
              </div>
              {co.description && <p className="mt-1 text-sm text-slate-400">{co.description}</p>}

              <p className="mt-1 text-xs text-slate-500">
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
                    <li key={proposal.id} className="flex items-center justify-between gap-2 text-sm text-slate-400">
                      <span>
                        <span className="text-slate-500">{proposal.changeType.toLowerCase()}</span>{" "}
                        {proposal.summary}
                      </span>
                      {co.status === "DRAFT" && (
                        <form action={removeProposal.bind(null, proposal.id)}>
                          <button className="text-xs text-slate-500 hover:text-rose-400">remove</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Audit trail of what actually landed, written on approval. */}
              {co.edits.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5">
                  {co.edits.map((edit) => (
                    <li key={edit.id} className="text-xs text-slate-500">
                      {edit.field}: {edit.oldValue} → {edit.newValue}
                    </li>
                  ))}
                </ul>
              )}

              {co.status === "DRAFT" && (
                <>
                  <ProposalForms changeOrder={co} lineItems={lineItems} />
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <form action={submitChangeOrder.bind(null, co.id)} className="flex flex-wrap items-end gap-2">
                      <label className={labelClass}>
                        Date sent to GC
                        <input name="submittedOn" type="date" defaultValue={today()} className={`${inputClass} w-40`} />
                      </label>
                      <button
                        disabled={co.proposals.length === 0}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Send to GC
                      </button>
                    </form>
                    <form action={deleteChangeOrderDraft.bind(null, co.id)}>
                      <button className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:bg-slate-800">
                        Discard draft
                      </button>
                    </form>
                  </div>
                </>
              )}

              {co.status === "SUBMITTED" && <Decision changeOrder={co} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
