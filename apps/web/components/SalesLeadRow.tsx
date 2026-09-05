"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesLead } from "@/lib/actions";
import { SALES_LEAD_SOURCE_OPTIONS } from "@/components/SalesLeadFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

const FOLLOW_UP_STYLE = {
  OVERDUE: "text-red-400",
  DUE_TODAY: "text-amber-300",
  UPCOMING: "text-slate-500",
} as const;

const FOLLOW_UP_LABEL = {
  OVERDUE: "Follow-up was due",
  DUE_TODAY: "Follow up today,",
  UPCOMING: "Follow up",
} as const;

/**
 * "No contact logged" is not "never contacted" and is deliberately worded
 * as a statement about the log rather than about the relationship — nobody
 * has written anything down, which is all this page can honestly claim.
 */
function lastContactLabel(lead: { lastContactOn: string | null; daysSinceContact: number | null }) {
  if (lead.lastContactOn === null || lead.daysSinceContact === null) return "No contact logged";
  if (lead.daysSinceContact === 0) return "Last contact today";
  if (lead.daysSinceContact === 1) return "Last contact yesterday";
  return `Last contact ${lead.daysSinceContact} days ago`;
}

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
    /** All derived from SalesActivity at read time — see lib/sales-activity.ts.
     * Every one of these is nullable and null never means zero: a lead with
     * no logged contact is not a lead contacted today. */
    lastContactOn: string | null;
    daysSinceContact: number | null;
    followUpOn: string | null;
    followUpStanding: "OVERDUE" | "DUE_TODAY" | "UPCOMING" | null;
  };
}) {
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
          <p className="text-xs text-slate-500">{lastContactLabel(lead)}</p>
          {lead.followUpStanding && (
            <p className={`text-xs ${FOLLOW_UP_STYLE[lead.followUpStanding]}`}>
              {FOLLOW_UP_LABEL[lead.followUpStanding]} {lead.followUpOn}
            </p>
          )}
        </div>
      </div>

      <RowActions
        className="flex items-center gap-2"
        destructive={
          <ConfirmDelete
            prompt={`Delete ${lead.companyName}?`}
            pendingLabel="Deleting…"
            pending={isPending}
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const result = await deleteSalesLead(lead.id);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.refresh();
                } catch {
                  setError("Could not delete the lead");
                }
              });
            }}
            deleteClassName={btn}
            cancelClassName={btn}
            confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          />
        }
      />

      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}
