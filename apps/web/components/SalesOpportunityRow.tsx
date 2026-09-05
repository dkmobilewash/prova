"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesOpportunity, updateSalesOpportunity } from "@/lib/actions";
import { SalesOpportunityFields } from "@/components/SalesOpportunityFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { localToday } from "@/components/localToday";
import { money } from "@/lib/money";
import { OPPORTUNITY_STAGE_OPTIONS, stageTiming, type StageSpell } from "@/lib/sales-stage-history";

export type SalesOpportunityRowData = {
  id: string;
  stage: string;
  estimatedMrr: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
};

/**
 * Everything about WHEN this deal moved, derived server-side from
 * SalesStageChange by lib/sales-stage-history.ts. Every field here is
 * nullable and null never means zero — an opportunity that predates the
 * history, or one nobody has moved yet, genuinely does not know.
 */
export type SalesOpportunityHistory = {
  /** Null when nothing is recorded. NOT the day the row was created. */
  stageSince: string | null;
  /** Null when nothing is recorded or the move is dated in the future. */
  daysInStage: number | null;
  futureDated: boolean;
  /** The stored stage is not where the history left the deal. */
  disagrees: boolean;
  spells: StageSpell[];
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

export function SalesOpportunityRow({
  opportunity,
  history,
}: {
  opportunity: SalesOpportunityRowData;
  history: SalesOpportunityHistory;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [showsHistory, setShowsHistory] = useState(false);
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
          <SalesOpportunityFields
            mode="edit"
            // The move date defaults to TODAY, not to when the deal last
            // moved: this field records the move you are making now.
            defaults={{ ...opportunity, stageEffectiveOn: localToday() }}
          />
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
            <span className="text-xs text-slate-500">
              {history.stageSince === null
                ? "stage not recorded"
                : history.futureDated
                  ? `recorded as moving ${history.stageSince}, which has not happened yet`
                  : `in this stage ${stageTiming(history.daysInStage)}`}
            </span>
          </div>
          {history.disagrees && (
            <p className="mt-1 text-xs text-amber-300">
              The recorded history leaves this deal somewhere else. Something changed the stage
              without recording the move — the two disagree and one of them is wrong.
            </p>
          )}
          {opportunity.notes && <p className="mt-1 text-sm text-slate-400">{opportunity.notes}</p>}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}

          {history.spells.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowsHistory((open) => !open)}
                className="mt-2 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
              >
                {showsHistory ? "Hide stage history" : `Stage history (${history.spells.length})`}
              </button>
              {showsHistory && (
                <ol className="mt-2 space-y-1 border-l border-slate-800 pl-3">
                  {history.spells.map((spell, index) => (
                    <li key={`${spell.enteredOn}-${index}`} className="text-xs text-slate-400">
                      <span className="text-slate-300">
                        {OPPORTUNITY_STAGE_OPTIONS.find((o) => o.value === spell.stage)?.label ?? spell.stage}
                      </span>{" "}
                      from {spell.enteredOn}
                      {spell.leftOn === null ? " (still)" : ` to ${spell.leftOn}`} —{" "}
                      {stageTiming(spell.days)}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>

        {/* Arming "Delete" empties this cluster, so "Edit" is not sitting
            live next to an armed confirm. The "Stage history" toggle is not
            in here — it is in the content column above, and reading history
            is not an action a mis-click can cost you anything. */}
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-2"
          destructive={
            <ConfirmDelete
              confirmLabel="Confirm delete"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await deleteSalesOpportunity(opportunity.id);
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
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
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
