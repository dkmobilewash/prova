"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesActivity, updateSalesActivity } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  SALES_ACTIVITY_TYPE_OPTIONS,
  SalesActivityFields,
  type OpportunityOption,
} from "@/components/SalesActivityFields";
import { dealLabelFor } from "@/lib/sales-activity";

export type SalesActivityRowData = {
  id: string;
  type: string;
  occurredOn: string;
  summary: string;
  followUpOn: string | null;
  opportunityId: string | null;
  /** Null when the row predates a logger, or the person has been deleted. */
  loggedByName: string | null;
  /**
   * False only for rows dated after today, which are no longer creatable —
   * createSalesActivity refuses them — but exist in databases written
   * before that guard. They supersede nothing and count as no contact, so
   * the row says so rather than claiming to be superseded.
   */
  hasOccurred: boolean;
};

const TYPE_STYLE: Record<string, string> = {
  CALL: "bg-neutral-800 text-ink-label",
  EMAIL: "bg-neutral-800 text-ink-label",
  DEMO: "bg-tag-blue text-tag-blue-ink",
  MEETING: "bg-tag-blue text-tag-blue-ink",
  NOTE: "bg-neutral-800 text-ink-muted",
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";

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
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
  // #153 finding 1: which deal this was about, collected on the form and
  // stored, but never shown anywhere until now.
  const dealLabel = dealLabelFor(activity.opportunityId, opportunityOptions);

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[activity.type] ?? TYPE_STYLE.NOTE}`}>
              {typeLabel}
            </span>
            <span className="text-sm text-ink-label">{activity.occurredOn}</span>
            {dealLabel && (
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-ink-body">
                Re: {dealLabel}
              </span>
            )}
            {!activity.hasOccurred && (
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-ink-body">
                dated in the future — not counted yet
              </span>
            )}
            {activity.followUpOn &&
              (isLatest ? (
                <span className="rounded-full bg-tag-amber px-2 py-0.5 text-xs font-medium text-tag-amber-ink">
                  Follow up {activity.followUpOn}
                </span>
              ) : activity.hasOccurred ? (
                <span className="text-xs text-ink-muted">
                  asked for a follow-up on {activity.followUpOn}, since superseded
                </span>
              ) : (
                <span className="text-xs text-ink-muted">
                  asks for a follow-up on {activity.followUpOn}
                </span>
              ))}
          </div>
          <p className="mt-1 text-sm text-ink-body">{activity.summary}</p>
          {activity.loggedByName && (
            <p className="mt-1 text-xs text-ink-muted">Logged by {activity.loggedByName}</p>
          )}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>

        {/* Issue #152, both rules, in the shared component rather than by
            hand. #183 wrapped the ordinary-action group in a guard, which
            fixed rule 1 on this row and left the arming state hand-rolled —
            the mechanism the census scans for, and the one a later merge
            fills back in. Now "Edit" is a child of RowActions and is not
            rendered at all while a delete is armed.

            This cluster is the last child of a `justify-between` parent and
            is `shrink-0`, so its RIGHT edge is pinned and the LAST control is
            the one that keeps its position: `pinned` is set to `end` so
            Cancel renders last and inherits the Delete pixel. Measured in
            Chromium at 1100px on this exact geometry: 0px overlap. */}
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-2"
          destructive={
            <ConfirmDelete
              pinned="end"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await deleteSalesActivity(activity.id);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.refresh();
                  } catch {
                    setError("Could not delete it");
                  }
                });
              }}
              deleteClassName={btn}
              cancelClassName={btn}
            />
          }
        >
          <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
            Edit
          </button>
        </RowActions>
      </div>
    </li>
  );
}
