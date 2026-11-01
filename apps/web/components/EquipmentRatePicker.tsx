"use client";

import Link from "next/link";
import { money } from "@/lib/money";
import { ratesOn, unitLabel, type EquipmentRateRow } from "@/lib/equipment-rates";

const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;

/**
 * Fills the Add scope form from a rate. It carries no `name`, so it is never sent:
 * the form's own boxes are what save, and a person can change any of them. The
 * price stays blank so the line goes through the bid recap, and a typed price still
 * wins. A description somebody already wrote is left alone.
 */
export function EquipmentRatePicker({ rates, day }: { rates: EquipmentRateRow[]; day: string }) {
  const inForce = ratesOn(rates, day);
  if (inForce.length === 0) {
    return (
      <Link href="/equipment/rates" className="inline-flex min-h-11 items-center text-xs text-link hover:underline">
        Add equipment rates →
      </Link>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-label">
      Equipment rate on {day}
      <select
        aria-label="Fill from an equipment rate"
        defaultValue=""
        className="w-56 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        onChange={(event) => {
          const rate = inForce.find((row) => row.id === event.target.value);
          const form = event.target.form;
          if (!rate || !form) return;
          const description = field(form, "itemDescription");
          if (description && !description.value.trim()) description.value = rate.name;
          const unit = field(form, "unit");
          if (unit) unit.value = unitLabel(rate.unit);
          const cost = field(form, "budgetedUnitCost");
          if (cost) cost.value = rate.rate.toFixed(2);
          const category = field(form, "costCategory");
          if (category) category.value = "EQUIPMENT";
        }}
      >
        <option value="">Choose to fill in…</option>
        {inForce.map((rate) => (
          <option key={rate.id} value={rate.id}>
            {rate.name}: {money(rate.rate)} per {unitLabel(rate.unit)}
          </option>
        ))}
      </select>
    </label>
  );
}
