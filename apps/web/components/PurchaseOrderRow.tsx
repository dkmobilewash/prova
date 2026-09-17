"use client";

import { useState, useTransition } from "react";
import {
  addPurchaseOrderLine,
  deletePurchaseOrder,
  deletePurchaseOrderLine,
  updatePurchaseOrder,
  updatePurchaseOrderLine,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import {
  PurchaseOrderFields,
  type PurchaseOrderDefaults,
  type PurchaseOrderVendorOption,
} from "@/components/PurchaseOrderFields";
import {
  PurchaseOrderLineFields,
  type CostCodeOption,
} from "@/components/PurchaseOrderLineFields";
import { lineTotal, orderTotal, unitSummary } from "@/components/purchaseOrderTotals";
import { renderPurchaseOrderDocument } from "@/lib/purchasing/purchase-order-document";
import { money } from "@/lib/money";

export type PurchaseOrderLineData = {
  id: string;
  lineItemId: string | null;
  /** The SOV line's description, when the line is coded to one. */
  costCode: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitCost: number;
};

export type PurchaseOrderRowData = PurchaseOrderDefaults & {
  id: string;
  number: number;
  jobId: string;
  jobName: string;
  vendorName: string;
  vendorNumber: string | null;
  vendorAddress: string | null;
  awardedOn: string;
  issuedByName: string | null;
  lines: PurchaseOrderLineData[];
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50";

/** One line of the order: its own edit form, its own armed delete.
 *
 * A separate component so each line owns its own state. A single `editingId`
 * on the order would mean one line's pending flag disabling every other
 * line's buttons, which reads as the page having frozen. */
function LineRow({
  line,
  costCodes,
  canEdit,
}: {
  line: PurchaseOrderLineData;
  costCodes: CostCodeOption[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft(`purchase-order-line:edit:${line.id}`);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="py-3">
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updatePurchaseOrderLine(line.id, formData),
              () => {
                draft.clear();
                setEditing(false);
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <FormDraftNotice draft={draft} />
          <PurchaseOrderLineFields
            costCodes={costCodes}
            defaults={{
              lineItemId: line.lineItemId,
              description: line.description,
              quantity: String(line.quantity),
              unit: line.unit,
              unitCost: String(line.unitCost),
            }}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Save line"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setEditing(false)} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-label">
          {line.description}
          {line.costCode && <span className="text-ink-muted"> · {line.costCode}</span>}
        </p>
        <p className="text-xs text-ink-body">
          {line.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          {line.unit ? ` ${line.unit}` : ""} @ {money(line.unitCost)} ={" "}
          <span className="text-ink">{money(lineTotal(line))}</span>
        </p>
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {canEdit && (
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-2"
          destructive={
            <ConfirmDelete
              describe="Removes this line from the order. The order and its number stay; nothing is sent to the vendor."
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => run(() => deletePurchaseOrderLine(line.id))}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            />
          }
        >
          <button type="button" disabled={isPending} onClick={() => setEditing(true)} className={btn}>
            Edit
          </button>
        </RowActions>
      )}
    </li>
  );
}

export function PurchaseOrderRow({
  order,
  vendors,
  costCodes,
  billToName,
  billToAddress,
  canDelete,
  showJob,
}: {
  order: PurchaseOrderRowData;
  vendors: PurchaseOrderVendorOption[];
  costCodes: CostCodeOption[];
  billToName: string;
  billToAddress: string | null;
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "addLine">("view");
  const [showPreview, setShowPreview] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editDraft = useFormDraft(`purchase-order:edit:${order.id}`);
  const lineDraft = useFormDraft(`purchase-order:add-line:${order.id}`);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          ref={editDraft.formRef}
          onChange={editDraft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updatePurchaseOrder(order.id, formData),
              () => {
                editDraft.clear();
                setMode("view");
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">
            PO {order.number} · {order.jobName}
          </p>
          <FormDraftNotice draft={editDraft} />
          <PurchaseOrderFields defaults={order} vendors={vendors} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "addLine") {
    return (
      <li className="p-4">
        <form
          ref={lineDraft.formRef}
          onChange={lineDraft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => addPurchaseOrderLine(order.id, formData),
              () => {
                lineDraft.clear();
                lineDraft.resetForm();
                setMode("view");
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">Add a line to PO {order.number}</p>
          <FormDraftNotice draft={lineDraft} />
          <PurchaseOrderLineFields
            costCodes={costCodes}
            defaults={{ lineItemId: null, description: "", quantity: "", unit: null, unitCost: "" }}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Add line"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const units = unitSummary(order.lines);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">PO {order.number}</span>
          <span className="text-ink">{order.vendorName}</span>
          {order.vendorNumber && (
            <span className="text-xs text-ink-muted">vendor #{order.vendorNumber}</span>
          )}
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body">
            {money(orderTotal(order.lines))}
          </span>
        </div>

        <p className="mt-1 text-sm text-ink-label">{order.title}</p>

        <p className="mt-1 text-xs text-ink-muted">
          {showJob && <span className="text-link">{order.jobName} · </span>}
          {`awarded ${order.awardedOn}`}
          {order.expectedOn ? ` · expected ${order.expectedOn}` : " · no date expected"}
          {order.paymentTerms && ` · ${order.paymentTerms}`}
          {order.issuedByName && ` · raised by ${order.issuedByName}`}
        </p>

        {order.lines.length === 0 ? (
          <p className="mt-2 text-sm text-ink-body">
            No line items yet. An order with nothing on it commits nothing — add what you are
            buying, one line at a time.
          </p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-line-row border-l-2 border-line-card pl-3">
              {order.lines.map((line) => (
                <LineRow key={line.id} line={line} costCodes={costCodes} canEdit />
              ))}
            </ul>
            <p className="mt-2 text-sm text-ink-label">
              <span className="text-ink-muted">Order total </span>
              {money(orderTotal(order.lines))}
              {units && <span className="text-ink-body"> · {units}</span>}
            </p>
          </>
        )}

        {order.shipToAddress && (
          <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">
            Ship to: {order.shipToAddress}
          </p>
        )}
        {order.notes && <p className="mt-1 text-xs text-ink-muted">{order.notes}</p>}

        {showPreview && (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-line-card bg-canvas p-3 text-xs text-ink-body">
            {renderPurchaseOrderDocument({
              number: order.number,
              title: order.title,
              jobName: order.jobName,
              billToName,
              billToAddress,
              vendorName: order.vendorName,
              vendorNumber: order.vendorNumber,
              vendorAddress: order.vendorAddress,
              shipToAddress: order.shipToAddress,
              paymentTerms: order.paymentTerms,
              awardedOn: order.awardedOn,
              expectedOn: order.expectedOn,
              notes: order.notes,
              lines: order.lines.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitCost: line.unitCost,
                costCode: line.costCode,
              })),
            })}
          </pre>
        )}

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Arming "Delete" empties this cluster: "Add line", "Edit" and the
          preview toggle are children of RowActions and are not rendered
          while the confirm is up. An ordinary action beside an armed
          confirm is issue #152 exactly — a click meant to cancel a delete
          landing on something else instead. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          canDelete && order.lines.length === 0 ? (
            <ConfirmDelete
              describe="Deletes this order from your record, and only while it has no lines. The number stays retired — the next order on this job is still the next number. Nothing is sent to the vendor."
              pinned="end"
              label="Delete"
              confirmLabel="Confirm delete"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => run(() => deletePurchaseOrder(order.id))}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setMode("addLine")}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          Add line
        </button>
        <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
          Edit
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowPreview((open) => !open)}
          className={btn}
        >
          {showPreview ? "Hide order" : "View order"}
        </button>
      </RowActions>
    </li>
  );
}
