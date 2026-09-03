"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesOpportunity, updateSalesOpportunity } from "@/lib/actions";
import { OPPORTUNITY_STAGE_OPTIONS, SalesOpportunityFields } from "@/components/SalesOpportunityFields";
import { money } from "@/lib/money";

export type SalesOpportunityRowData = {
  id: string;
  stage: string;
  estimatedMrr: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
};

const STAGE_STYLE: Record<string, string> = {
  NEW: "bg-slate-800 text-slate-300",
  CONTACTED: "bg-slate-800 text-slate-300",
  DEMO_SCHEDULED: "bg-blue-500/15 text-blue-300",
  TRIAL: "bg-blue-500/15 text-blue-300",
  WON: "bg-green-500/15 text-green-300",
  LOST: "bg-red-950 text-red-400",
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function SalesOpportunityRow({ opportunity }: { opportunity: SalesOpportunityRowData }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              try {
                const result = await updateSalesOpportunity(opportunity.id, formData);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
                setMode("view");
              } catch {
                setError("Could not save changes");
              }
            });
          }}
          className="flex flex-col gap-3"
        >
          <SalesOpportunityFields defaults={opportunity} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
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

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[opportunity.stage]}`}>
              {OPPORTUNITY_STAGE_OPTIONS.find((o) => o.value === opportunity.stage)?.label ?? opportunity.stage}
            </span>
            {opportunity.estimatedMrr && (
              <span className="text-sm text-slate-300">{money(Number(opportunity.estimatedMrr))}/mo</span>
            )}
            {opportunity.expectedCloseDate && (
              <span className="text-xs text-slate-500">expected {opportunity.expectedCloseDate}</span>
            )}
          </div>
          {opportunity.notes && <p className="mt-1 text-sm text-slate-400">{opportunity.notes}</p>}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
            Edit
          </button>
          {isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await deleteSalesOpportunity(opportunity.id);
                      if (!result.ok) {
                        setError(result.error);
                        setIsConfirmingDelete(false);
                        return;
                      }
                      router.refresh();
                    } catch {
                      setError("Could not delete it");
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
            <button type="button" disabled={isPending} onClick={() => setIsConfirmingDelete(true)} className={btn}>
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
