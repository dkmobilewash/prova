"use client";

import { priceMaterial } from "@/lib/actions";
import type { UnpricedMaterial } from "@/lib/estimating/materialKey";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";

/**
 * "Price these 6 materials" — the estimate's unpriced material lines, each material once, with one
 * cost box. A cost entered here becomes the company's own catalog entry and prices every line of that
 * material through the markup (`priceMaterial`). Nothing here suggests a figure: an empty box is
 * the honest state of a material nobody has priced.
 */
export function PriceTheseMaterials({ jobId, materials }: { jobId: string; materials: UnpricedMaterial[] }) {
  if (materials.length === 0) return null;
  return (
    <section data-estimate="price-these" className="mb-6 rounded-lg border border-brand bg-surface px-4 py-3">
      <h2 className="text-base font-semibold text-ink">
        Price these {materials.length} material{materials.length === 1 ? "" : "s"}
      </h2>
      <p className="mb-2 text-sm text-ink-body">
        The walls worked these out, and your price book has no cost for them. Type what one unit costs you; it goes into your price book and prices every line below that uses it, with your markup.
      </p>
      <ul className="divide-y divide-line-row">
        {materials.map((m) => (
          <li key={m.group} data-estimate="price-these-row" className="py-2">
            <ActionForm action={priceMaterial.bind(null, jobId, m.lineIds)} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm text-ink">
                {m.label}
                <span className="block text-xs text-ink-muted">
                  {Math.round(m.quantity * 100) / 100} {m.unit ?? ""} on {m.lineIds.length} line{m.lineIds.length === 1 ? "" : "s"}
                </span>
              </span>
              <label className="inline-flex items-center gap-1 text-sm text-ink-body">
                $
                <input
                  name="unitCost"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  aria-label={`Your cost for one ${m.unit ?? "unit"} of ${m.label}`}
                  className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink"
                  data-estimate="price-these-cost"
                />
                per {m.unit ?? "unit"}
              </label>
              <SubmitButton type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50">
                Save cost
              </SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}
