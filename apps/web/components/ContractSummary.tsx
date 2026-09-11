import type { ReactNode } from "react";
import { StatusBadge } from "@prova/ui";
import { money } from "@/lib/money";

/**
 * Issue #106 finding 6, pulled out as a pure function so the wording
 * decision is testable without rendering the component — this repo has no
 * React component test harness, so logic like this is extracted rather
 * than left inline. `frozen: true` is /esign/[token]'s SIGNED branch,
 * where `lineItems` come from a frozen `SignatureRequest.snapshot`
 * sitting a few lines below a banner that already says "This reflects
 * exactly what was agreed to at the time of signing." The old caption
 * claimed "current" unconditionally and contradicted that banner on
 * exactly this render.
 */
export function contractSummaryFooterCopy(frozen: boolean): string {
  return frozen
    ? "This reflects the scope and pricing agreed to at the time of signing. It does not include any change order approved afterward."
    : "This reflects the current agreed scope and pricing for this job, including any approved change orders.";
}

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
  frozen = false,
}: {
  companyName: string;
  jobName: string;
  status: string;
  clientName: string;
  scope: string | null;
  lineItems: ContractSummaryLineItem[];
  footer?: ReactNode;
  /** Issue #106 finding 6. `false` (the default) is every LIVE render of
   * this component — /jobs/[id], /portal, and the unsigned /esign view —
   * where "current agreed scope and pricing" is true: it reads
   * JobLineItem fresh, so an approved change order really does show up
   * here. `true` is exactly one caller: /esign/[token]'s SIGNED branch,
   * which passes `lineItems` from a frozen `SignatureRequest.snapshot`
   * instead — data that was true at signing and will never move again,
   * sitting on the same page as a banner that already says so. The old
   * single caption claimed "current" in both cases, contradicting that
   * banner on the one render where it doesn't apply. */
  frozen?: boolean;
}) {
  const total = lineItems.reduce(
    (sum, item) => sum + (item.unitPrice != null ? Number(item.quantity) * Number(item.unitPrice) : 0),
    0,
  );

  // Dark on screen, white on paper.
  //
  // This is a document — it has print: rules and is meant to read as one —
  // but it was white on screen too, which made it the ONE light surface in
  // the whole product and the worst visual break in it: clicking a job
  // from the dashboard dropped a bright slab into a dark app, on the page
  // you spend the most time on when walking the money. The document
  // metaphor is worth something when it comes out of a printer and nothing
  // at all on screen.
  //
  // Its footnote had also inherited slate-400, which is 2.56:1 on white —
  // the lowest contrast anywhere in the app, found in a pre-demo
  // walkthrough rather than by any check.
  return (
    <section className="rounded-lg border border-line-card bg-surface p-6 text-ink print:border-0 print:bg-white print:text-slate-900 print:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-body print:text-ink-muted">{companyName}</p>
          <h1 className="text-2xl font-semibold">{jobName}</h1>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-ink-body print:text-ink-muted">Client: {clientName}</p>
      {scope && <p className="mt-3 text-sm text-ink-label print:text-slate-700">{scope}</p>}

      {/* The client signs this on a phone as often as a desktop. Without a
          scroller of its own, a five-column table drags the whole page
          sideways. */}
      <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-line-card text-left text-ink-body print:border-slate-200 print:text-ink-muted">
            <th className="py-2">Description</th>
            <th className="py-2">Qty</th>
            <th className="py-2">Unit</th>
            <th className="py-2">Unit price</th>
            <th className="py-2 text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item) => (
            <tr key={item.id} className="border-b border-line-row print:border-slate-100">
              <td className="py-2">
                {item.description}
                {item.changeOrderNumber != null && (
                  <span className="ml-2 rounded bg-tag-amber px-1.5 py-0.5 text-xs text-tag-amber-ink print:bg-amber-100 print:text-amber-800">
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
      </div>

      <p className="mt-4 text-right text-lg font-semibold">Total: {money(total)}</p>

      <p className="mt-6 text-xs text-ink-body print:mt-16 print:text-ink-muted">
        {contractSummaryFooterCopy(frozen)}
      </p>

      {footer && <div className="mt-4 print:hidden">{footer}</div>}
    </section>
  );
}
