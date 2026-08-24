import type { ReactNode } from "react";
import { StatusBadge } from "@prova/ui";
import { money } from "@/lib/money";

export type ContractSummaryLineItem = {
  id: string;
  description: string;
  quantity: string;
  unit: string | null;
  /// Null for a cost-only budget line (general conditions, overhead,
  /// contingency) — it has no client-facing sale price and contributes $0
  /// to the contract total, rendered as "—" rather than $0.00.
  unitPrice: string | null;
  changeOrderNumber: number | null;
};

/**
 * The contract-style rendering of a job's line items — used on both
 * /jobs/[id] (contractor view) and /esign/[token] (public client-signing
 * view) so they can never drift apart. Same JobLineItem data, same markup,
 * two places it's read from.
 */
export function ContractSummary({
  companyName,
  jobName,
  status,
  clientName,
  scope,
  lineItems,
  footer,
}: {
  companyName: string;
  jobName: string;
  status: string;
  clientName: string;
  scope: string | null;
  lineItems: ContractSummaryLineItem[];
  footer?: ReactNode;
}) {
  const total = lineItems.reduce(
    (sum, item) => sum + (item.unitPrice != null ? Number(item.quantity) * Number(item.unitPrice) : 0),
    0,
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 text-slate-900 print:border-0 print:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{companyName}</p>
          <h1 className="text-2xl font-semibold">{jobName}</h1>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-slate-600">Client: {clientName}</p>
      {scope && <p className="mt-3 text-sm text-slate-700">{scope}</p>}

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">Description</th>
            <th className="py-2">Qty</th>
            <th className="py-2">Unit</th>
            <th className="py-2">Unit price</th>
            <th className="py-2 text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="py-2">
                {item.description}
                {item.changeOrderNumber != null && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    CO #{item.changeOrderNumber}
                  </span>
                )}
              </td>
              <td className="py-2">{item.quantity}</td>
              <td className="py-2">{item.unit ?? "—"}</td>
              <td className="py-2">{item.unitPrice != null ? money(Number(item.unitPrice)) : "—"}</td>
              <td className="py-2 text-right">
                {item.unitPrice != null ? money(Number(item.quantity) * Number(item.unitPrice)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4 text-right text-lg font-semibold">Total: {money(total)}</p>

      <p className="mt-6 text-xs text-slate-400 print:mt-16">
        This reflects the current agreed scope and pricing for this job, including any approved
        change orders.
      </p>

      {footer && <div className="mt-4 print:hidden">{footer}</div>}
    </section>
  );
}
