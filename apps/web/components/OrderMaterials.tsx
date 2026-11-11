"use client";

import Link from "next/link";
import { useState } from "react";
import { orderMaterials, type MaterialOrderResult } from "@/lib/actions";
import { money } from "@/lib/money";
import { Spinner } from "./Spinner";

/**
 * "Order materials" on a contracted job's Estimate tab: the material lines as DRAFT
 * purchase orders for one supplier, priced from its imported price list, in whole
 * packs (`orderMaterials`). The drafts are checked, issued and sent on Buyout, as
 * any PO is.
 */
export function OrderMaterials({ jobId, suppliers }: { jobId: string; suppliers: { id: string; name: string }[] }) {
  const [vendorId, setVendorId] = useState(suppliers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MaterialOrderResult | null>(null);

  if (suppliers.length === 0) {
    return (
      <p className="text-sm text-ink-muted" data-order="no-suppliers">
        To order materials from the estimate, import a supplier&apos;s price list on the{" "}
        <Link href="/catalog" className="text-link hover:underline">
          Price book
        </Link>
        .
      </p>
    );
  }

  async function order() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await orderMaterials(jobId, vendorId);
      if (!result.ok) setError(result.error);
      else setDone(result.value);
    } catch {
      setError("Couldn't make the order just now: the connection dropped. Check Buyout before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4" data-order="panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-ink-label">
          Order materials from
          <select
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
            className="ml-2 min-h-11 rounded-md border border-line-card bg-surface px-2 text-sm text-ink"
            data-order="supplier"
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void order()} disabled={busy || vendorId === ""} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 disabled:opacity-50" data-order="go">
          {busy && <Spinner />}
          {busy ? "Making the drafts…" : "Order materials"}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Turns the estimate&apos;s material lines into draft purchase orders at this supplier&apos;s prices, in whole boxes, pails, rolls and pieces. Nothing is sent: check, issue and send them on Buyout.
      </p>
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {done !== null && (
        <div role="status" className="mt-3 text-sm text-ink" data-order="done">
          <ul className="list-disc pl-5">
            {done.orders.map((o) => (
              <li key={o.id} data-order="po">
                PO {o.number}
                {o.phase ? ` (${o.phase})` : ""}: {o.lines} line{o.lines === 1 ? "" : "s"}, {money(o.amount)}, draft
              </li>
            ))}
          </ul>
          {done.skipped.length > 0 && (
            <div className="mt-2" data-order="skipped">
              <p className="font-medium">Not ordered, add these by hand on Buyout:</p>
              <ul className="list-disc pl-5 text-ink-body">
                {done.skipped.map((s, i) => (
                  <li key={i}>
                    {s.description}: {s.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href={`/jobs/${jobId}/buyout`} className="mt-2 inline-block text-link hover:underline" data-order="open-buyout">
            Check and send them on Buyout →
          </Link>
        </div>
      )}
    </div>
  );
}
