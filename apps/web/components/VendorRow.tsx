"use client";

import { useState, useTransition } from "react";
import { deleteVendor } from "@/lib/actions";
import { tradeScopeLabel } from "@/components/tradeScopeLabels";

type VendorRowProps = {
  canDelete: boolean;
  vendor: {
    id: string;
    name: string;
    tradeScope: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  };
};

export function VendorRow({ canDelete, vendor }: VendorRowProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const trade = tradeScopeLabel(vendor.tradeScope);
  const contactLine = [vendor.contactName, vendor.phone, vendor.email].filter(Boolean).join(" · ");

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{vendor.name}</p>
        {trade && <p className="text-xs text-blue-400">{trade}</p>}
        <p className="text-sm text-slate-400">{contactLine || "No contact info"}</p>
        {vendor.notes && <p className="mt-1 text-sm text-slate-500">{vendor.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {canDelete && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await deleteVendor(vendor.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not delete vendor");
              }
            });
          }}
          className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
        >
          {isPending ? "Removing…" : "Remove"}
        </button>
      )}
    </li>
  );
}
