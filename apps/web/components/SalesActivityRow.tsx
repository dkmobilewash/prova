"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesActivity, updateSalesActivity } from "@/lib/actions";
import {
  SALES_ACTIVITY_TYPE_OPTIONS,
  SalesActivityFields,
  type OpportunityOption,
} from "@/components/SalesActivityFields";

export type SalesActivityRowData = {
  id: string;
  type: string;
  occurredOn: string;
  summary: string;
  followUpOn: string | null;
  opportunityId: string | null;
  /** Null when the row predates a logger, or the person has been deleted. */
  loggedByName: string | null;
};

const TYPE_STYLE: Record<string, string> = {
  CALL: "bg-slate-800 text-slate-300",
  EMAIL: "bg-slate-800 text-slate-300",
  DEMO: "bg-blue-500/15 text-blue-300",
  MEETING: "bg-blue-500/15 text-blue-300",
  NOTE: "bg-slate-800 text-slate-500",
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function SalesActivityRow({
  activity,
  opportunityOptions,
  /** True only for the lead's most recent activity — the one whose
   * followUpOn is what the lead actually owes. Every older row's
   * follow-up is history, and labelling them all "Follow up 12 Feb" would
   * show four open follow-ups for one conversation. */
  isLatest,
}: {
  activity: SalesActivityRowData;
  opportunityOptions: readonly OpportunityOption[];
  isLatest: boolean;
}) {
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
                const result = await updateSalesActivity(activity.id, formData);
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
          <SalesActivityFields defaults={activity} opportunityOptions={opportunityOptions} />
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

  const typeLabel =
    SALES_ACTIVITY_TYPE_OPTIONS.find((o) => o.value === activity.type)?.label ?? activity.type;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[activity.type] ?? TYPE_STYLE.NOTE}`}>
              {typeLabel}
            </span>
            <span className="text-sm text-slate-300">{activity.occurredOn}</span>
            {activity.followUpOn &&
              (isLatest ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                  Follow up {activity.followUpOn}
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  asked for a follow-up on {activity.followUpOn}, since superseded
                </span>
              ))}
          </div>
          <p className="mt-1 text-sm text-slate-400">{activity.summary}</p>
          {activity.loggedByName && (
            <p className="mt-1 text-xs text-slate-600">Logged by {activity.loggedByName}</p>
          )}
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
                      const result = await deleteSalesActivity(activity.id);
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
