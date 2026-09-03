"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesLead } from "@/lib/actions";
import { SALES_LEAD_SOURCE_OPTIONS } from "@/components/SalesLeadFields";

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function SalesLeadRow({
  lead,
}: {
  lead: {
    id: string;
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    source: string | null;
    opportunityCount: number;
  };
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/sales/${lead.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-slate-100">{lead.companyName}</p>
              {lead.source && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {SALES_LEAD_SOURCE_OPTIONS.find((o) => o.value === lead.source)?.label ?? lead.source}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400">
              {[lead.contactName, lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact info"}
            </p>
          </div>
        </Link>
        <div className="shrink-0 text-right text-sm text-slate-400">
          <p>
            {lead.opportunityCount} {lead.opportunityCount === 1 ? "opportunity" : "opportunities"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isConfirmingDelete ? (
          <>
            <span className="text-xs text-slate-400">Delete {lead.companyName}?</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await deleteSalesLead(lead.id);
                    if (!result.ok) {
                      setError(result.error);
                      setIsConfirmingDelete(false);
                      return;
                    }
                    router.refresh();
                  } catch {
                    setError("Could not delete the lead");
                    setIsConfirmingDelete(false);
                  }
                });
              }}
              className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Confirm delete"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setIsConfirmingDelete(false)} className={btn}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setIsConfirmingDelete(true)} className={btn}>
            Delete
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}
