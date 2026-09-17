"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

/** A job's SOV lines — what a contractor writes in the phase/cost code
 * column. Attribution only; no money is carried through it. */
export type CostCodeOption = { id: string; description: string };

export type PurchaseOrderLineDefaults = {
  lineItemId: string | null;
  description: string;
  quantity: string;
  unit: string | null;
  unitCost: string;
};

/**
 * One line of a purchase order, shared by the add form and the inline edit
 * form so the two cannot drift.
 *
 * THE COST CODE IS A `JobLineItem`, AND THAT IS NOT AN IMPROVISATION. It is
 * the app's existing coding concept — the same field `TimeEntryFields`
 * labels "Cost code / SOV line", and the same one a material order is
 * attributed against. There is no separate phase-code table in this build,
 * and inventing a second one so that a purchase order could have its own
 * would be far worse than reusing the one every other record already codes
 * against.
 */
export function PurchaseOrderLineFields({
  defaults,
  costCodes,
}: {
  defaults: PurchaseOrderLineDefaults;
  costCodes: CostCodeOption[];
}) {
  return (
    <>
      {costCodes.length > 0 && (
        <label className={labelClass}>
          Cost code / SOV line
          <select name="lineItemId" defaultValue={defaults.lineItemId ?? ""} className={inputClass}>
            <option value="">Not coded to a line</option>
            {costCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.description}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-muted">
            Optional, and for attribution only — it says which scope this material is bought for.
            No cost is summed through it; actual cost stays on the job&apos;s cost entries.
          </span>
        </label>
      )}

      <label className={labelClass}>
        Description
        <input
          type="text"
          name="description"
          required
          defaultValue={defaults.description}
          placeholder="e.g. Quiet Rock QR-510 5/8 4x12"
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">In the words the vendor will read.</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Quantity
          <input
            type="number"
            name="quantity"
            required
            min="0"
            step="0.01"
            defaultValue={defaults.quantity}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Unit
          <input
            type="text"
            name="unit"
            defaultValue={defaults.unit ?? ""}
            placeholder="e.g. sheets, LF"
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            As they sell it. Never converted — quantities total per unit, never across them.
          </span>
        </label>
        <label className={labelClass}>
          Unit cost
          <input
            type="number"
            name="unitCost"
            required
            min="0"
            step="0.01"
            defaultValue={defaults.unitCost}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">Per unit. The extended total is worked out.</span>
        </label>
      </div>
    </>
  );
}
