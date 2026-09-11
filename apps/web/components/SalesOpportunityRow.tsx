"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesOpportunity, updateSalesOpportunity } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SalesOpportunityFields } from "@/components/SalesOpportunityFields";
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
  NEW: "bg-neutral-800 text-ink-label",
  CONTACTED: "bg-neutral-800 text-ink-label",
  DEMO_SCHEDULED: "bg-tag-blue text-tag-blue-ink",
  TRIAL: "bg-tag-blue text-tag-blue-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-red-400",
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";

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

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[opportunity.stage]}`}>
              {OPPORTUNITY_STAGE_OPTIONS.find((o) => o.value === opportunity.stage)?.label ?? opportunity.stage}
            </span>
            {opportunity.estimatedMrr && (
              <span className="text-sm text-ink-label">{money(Number(opportunity.estimatedMrr))}/mo</span>
            )}
            {opportunity.expectedCloseDate && (
              <span className="text-xs text-ink-muted">expected {opportunity.expectedCloseDate}</span>
            )}
            <span className="text-xs text-ink-muted">
              {history.stageSince === null
                ? "stage not recorded"
                : history.futureDated
                  ? `recorded as moving ${history.stageSince}, which has not happened yet`
                  : `in this stage ${stageTiming(history.daysInStage)}`}
            </span>
          </div>
          {history.disagrees && (
            <p className="mt-1 text-xs text-tag-amber-ink">
              The recorded history leaves this deal somewhere else. Something changed the stage
              without recording the move — the two disagree and one of them is wrong.
            </p>
          )}
          {opportunity.notes && <p className="mt-1 text-sm text-ink-body">{opportunity.notes}</p>}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}

          {history.spells.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowsHistory((open) => !open)}
                className="mt-2 text-xs text-ink-muted underline underline-offset-2 hover:text-ink-label"
              >
                {showsHistory ? "Hide stage history" : `Stage history (${history.spells.length})`}
              </button>
              {showsHistory && (
                <ol className="mt-2 space-y-1 border-l border-line-row pl-3">
                  {history.spells.map((spell, index) => (
                    <li key={`${spell.enteredOn}-${index}`} className="text-xs text-ink-body">
                      <span className="text-ink-label">
                        {OPPORTUNITY_STAGE_OPTIONS.find((o) => o.value === spell.stage)?.label ?? spell.stage}
                      </span>{" "}
                      from {spell.enteredOn}
                      {spell.leftOn === null ? " (still)" : ` to ${spell.leftOn}`} —{" "}
                      {stageTiming(spell.days)}
                      {/* #164: the note explaining WHY this move happened was
                          stored and read back into `spell.note`, but nothing
                          rendered it -- the history showed stage, dates and
                          days-in-stage and silently dropped the one field a
                          person actually typed. */}
                      {spell.note && <p className="mt-0.5 text-ink-muted">&ldquo;{spell.note}&rdquo;</p>}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>

        {/* Issue #152 in the shared component rather than by hand — see the
            note in SalesActivityRow. Same geometry: right-pinned cluster, so
            `pinned` is `end` and Cancel keeps the vacated Delete pixel. */}
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
