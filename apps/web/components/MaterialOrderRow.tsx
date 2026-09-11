"use client";

import { useState, useTransition } from "react";
import {
  deleteMaterialDelivery,
  deleteMaterialOrder,
  recordMaterialDelivery,
  updateMaterialOrder,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import {
  MaterialOrderFields,
  type LineItemOption,
  type MaterialOrderDefaults,
  type VendorOption,
} from "@/components/MaterialOrderFields";
import {
  type DeliveryData,
  daysBetween,
  daysLate,
  isLate,
  orderState,
  stateLabel,
} from "@/components/materialOrderLabels";
import { localToday } from "@/components/localToday";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export type MaterialOrderRowData = MaterialOrderDefaults & {
  id: string;
  number: number;
  jobId: string;
  jobName: string;
  lineItemDescription: string | null;
  vendorName: string;
  orderedOn: string;
  orderedByName: string | null;
  deliveries: DeliveryData[];
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50";

export function MaterialOrderRow({
  order,
  today,
  vendors,
  lineItems,
  canDelete,
  showJob,
}: {
  order: MaterialOrderRowData;
  today: string;
  vendors: VendorOption[];
  lineItems: LineItemOption[];
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "receive">("view");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the order id so two rows can never share a draft; edit and
  // receive are different forms with different fields, so different keys.
  const editDraft = useFormDraft(`material-order:edit:${order.id}`);
  const receiveDraft = useFormDraft(`material-order:receive:${order.id}`);

  // Actions in this feature return their failures instead of throwing —
  // production redacts thrown Server Action messages to a digest,
  // verified 2026-08-27 on a real production build.
  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  const state = orderState(order.deliveries);
  const late = isLate(order.deliveries, order.promisedFor, today);
  const lateBy = daysLate(order.deliveries, order.promisedFor, today);

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
              () => updateMaterialOrder(order.id, formData),
              () => {
                editDraft.clear();
                setMode("view");
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">
            Order {order.number} · {order.jobName} · ordered {order.orderedOn}
          </p>
          <FormDraftNotice draft={editDraft} />
          <MaterialOrderFields defaults={order} vendors={vendors} lineItems={lineItems} fixedJobId={order.jobId} />
          {error && <p className="text-sm text-red-600">{error}</p>}
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

  if (mode === "receive") {
    return (
      <li className="p-4">
        <form
          ref={receiveDraft.formRef}
          onChange={receiveDraft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => recordMaterialDelivery(order.id, formData),
              () => {
                receiveDraft.clear();
                setMode("view");
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">
            What showed up against order {order.number}?
          </p>
          <FormDraftNotice draft={receiveDraft} />

          <label className={labelClass}>
            Date delivered
            <input
              type="date"
              name="deliveredOn"
              required
              defaultValue={localToday()}
              className={inputClass}
            />
            <span className="text-xs text-ink-muted">
              The date it actually arrived, not today — backdate it when you&apos;re catching up.
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-ink-label">
            <input type="checkbox" name="completesOrder" className="mt-1" />
            <span>
              That&apos;s everything — close this order out
              <span className="block text-xs text-ink-muted">
                Leave unticked if part of the order is still coming. You can record another delivery
                against it later.
              </span>
            </span>
          </label>

          <label className={labelClass}>
            Notes
            <textarea
              name="notes"
              rows={2}
              placeholder="What arrived, what was short, what was damaged."
              className={inputClass}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Record delivery"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const stateChip =
    state === "COMPLETE"
      ? "bg-tag-green text-tag-green-ink"
      : state === "PARTIAL"
        ? "bg-tag-amber text-tag-amber-ink"
        : "bg-neutral-100 text-ink-body";

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">MO {order.number}</span>
          <span className="text-ink">{order.vendorName}</span>
          {/* Both chips show when late: "late" is about the promised date,
              "partly delivered" is about what physically arrived, and the
              two answer different questions. */}
          {late && (
            <span className="rounded bg-tag-rose px-1.5 py-0.5 text-xs text-tag-rose-ink">
              Late by {lateBy} day{lateBy === 1 ? "" : "s"}
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 text-xs ${stateChip}`}>{stateLabel(state)}</span>
        </div>

        <p className="mt-1 text-sm text-ink-label">{order.description}</p>

        <ul className="mt-2 flex flex-col gap-1 border-l-2 border-line-card pl-3">
          <li className="text-xs text-ink-body">
            <span className="font-mono text-ink-muted">ORD</span>
            {` · placed ${order.orderedOn}`}
            {order.promisedFor && ` · promised ${order.promisedFor}`}
            {!order.promisedFor && " · no date promised"}
          </li>
          {order.deliveries.map((delivery) => (
            <li key={delivery.id} className="text-xs text-ink-body">
              <span className="font-mono text-ink-muted">DEL</span>
              {` · arrived ${delivery.deliveredOn}`}
              {` · ${daysBetween(order.orderedOn, delivery.deliveredOn)} day${
                daysBetween(order.orderedOn, delivery.deliveredOn) === 1 ? "" : "s"
              } after ordering`}
              {delivery.completesOrder && " · closed the order out"}
              {delivery.notes && <span className="text-ink-muted"> — {delivery.notes}</span>}
              {/* A delivery line has no other action TODAY. It goes through
                  RowActions anyway so that it cannot grow one: the next
                  button added here becomes a child and is covered by the
                  armed state without anyone remembering to cover it. Each
                  delivery owns its own armed state, so the keyed
                  `confirmingDeliveryId` is gone. */}
              <RowActions
                as="span"
                destructive={
                  <ConfirmDelete
                    label="Remove"
                    confirmLabel="Confirm remove"
                    pendingLabel="Removing…"
                    pending={isPending}
                    onConfirm={() => run(() => deleteMaterialDelivery(delivery.id))}
                    deleteClassName="ml-2 text-ink-muted underline disabled:opacity-50"
                    cancelClassName="ml-2 text-ink-body underline disabled:opacity-50"
                    confirmClassName="ml-2 text-red-600 underline disabled:opacity-50"
                  />
                }
              />
            </li>
          ))}
        </ul>

        <p className="mt-1 text-xs text-ink-muted">
          {showJob && <span className="text-link">{order.jobName} · </span>}
          {order.lineItemDescription && (
            <span className="text-ink-body">for {order.lineItemDescription} · </span>
          )}
          {order.vendorReference && `their #${order.vendorReference}`}
          {order.orderedByName &&
            `${order.vendorReference ? " · " : ""}ordered by ${order.orderedByName}`}
        </p>

        {order.notes && <p className="mt-1 text-xs text-ink-muted">{order.notes}</p>}

        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>

      {/* Arming "Delete" empties this row: "Record delivery" and "Edit" are
          children of RowActions and are not rendered while the confirm is
          up. "Record delivery" beside an armed confirm was the exact shape
          of issue #152 — a click meant to cancel a delete instead recorded
          an arrival that never happened. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          canDelete && order.deliveries.length === 0 ? (
            <ConfirmDelete
              pinned="end"
              label="Delete"
              confirmLabel="Confirm delete"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => run(() => deleteMaterialOrder(order.id))}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-600 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        {state !== "COMPLETE" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("receive")}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50"
          >
            Record delivery
          </button>
        )}

        <button
          type="button"
          disabled={isPending}
          onClick={() => setMode("edit")}
          className={btn}
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}
