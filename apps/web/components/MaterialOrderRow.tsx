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
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50";

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
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateMaterialOrder(order.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            Order {order.number} · {order.jobName} · ordered {order.orderedOn}
          </p>
          <MaterialOrderFields defaults={order} vendors={vendors} lineItems={lineItems} fixedJobId={order.jobId} />
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

  if (mode === "receive") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => recordMaterialDelivery(order.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            What showed up against order {order.number}?
          </p>

          <label className={labelClass}>
            Date delivered
            <input
              type="date"
              name="deliveredOn"
              required
              defaultValue={localToday()}
              className={inputClass}
            />
            <span className="text-xs text-slate-500">
              The date it actually arrived, not today — backdate it when you&apos;re catching up.
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" name="completesOrder" className="mt-1" />
            <span>
              That&apos;s everything — close this order out
              <span className="block text-xs text-slate-500">
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

          {error && <p className="text-sm text-red-400">{error}</p>}

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
      ? "bg-green-500/15 text-green-300"
      : state === "PARTIAL"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-slate-800 text-slate-400";

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-500">MO {order.number}</span>
          <span className="text-slate-100">{order.vendorName}</span>
          {/* Both chips show when late: "late" is about the promised date,
              "partly delivered" is about what physically arrived, and the
              two answer different questions. */}
          {late && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
              Late by {lateBy} day{lateBy === 1 ? "" : "s"}
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 text-xs ${stateChip}`}>{stateLabel(state)}</span>
        </div>

        <p className="mt-1 text-sm text-slate-300">{order.description}</p>

        <ul className="mt-2 flex flex-col gap-1 border-l-2 border-slate-700 pl-3">
          <li className="text-xs text-slate-400">
            <span className="font-mono text-slate-500">ORD</span>
            {` · placed ${order.orderedOn}`}
            {order.promisedFor && ` · promised ${order.promisedFor}`}
            {!order.promisedFor && " · no date promised"}
          </li>
          {order.deliveries.map((delivery) => (
            <li key={delivery.id} className="text-xs text-slate-400">
              <span className="font-mono text-slate-500">DEL</span>
              {` · arrived ${delivery.deliveredOn}`}
              {` · ${daysBetween(order.orderedOn, delivery.deliveredOn)} day${
                daysBetween(order.orderedOn, delivery.deliveredOn) === 1 ? "" : "s"
              } after ordering`}
              {delivery.completesOrder && " · closed the order out"}
              {delivery.notes && <span className="text-slate-500"> — {delivery.notes}</span>}
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
                    deleteClassName="ml-2 text-slate-500 underline disabled:opacity-50"
                    cancelClassName="ml-2 text-slate-400 underline disabled:opacity-50"
                    confirmClassName="ml-2 text-red-400 underline disabled:opacity-50"
                  />
                }
              />
            </li>
          ))}
        </ul>

        <p className="mt-1 text-xs text-slate-500">
          {showJob && <span className="text-blue-400">{order.jobName} · </span>}
          {order.lineItemDescription && (
            <span className="text-slate-400">for {order.lineItemDescription} · </span>
          )}
          {order.vendorReference && `their #${order.vendorReference}`}
          {order.orderedByName &&
            `${order.vendorReference ? " · " : ""}ordered by ${order.orderedByName}`}
        </p>

        {order.notes && <p className="mt-1 text-xs text-slate-500">{order.notes}</p>}

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
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
              label="Delete"
              confirmLabel="Confirm delete"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => run(() => deleteMaterialOrder(order.id))}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          ) : null
        }
      >
        {state !== "COMPLETE" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("receive")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
