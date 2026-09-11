"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePrevailingWageRuleSet, updatePrevailingWageRuleSet } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { RuleSetFields, type RuleSetDefaults } from "@/components/RuleSetFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  authorityLabel,
  filingFrequencyLabel,
  thresholdLabel,
} from "@/components/prevailingWageLabels";

export type RuleSetRowData = RuleSetDefaults & {
  id: string;
  jobNames: string[];
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";

export function RuleSetRow({
  ruleSet,
  today,
  canDelete,
}: {
  ruleSet: RuleSetRowData;
  today: string;
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        // On top of the action's own revalidatePath. Browser testing found
      // two union-compliance forms leaving the page stale until a manual
      // reload while others updated live; every action revalidates and
      // every form calls them the same way, so this is NOT a root-cause
      // fix. It is applied here because these components share that exact
      // pattern, and the same bug would sit unseen until someone hit it.
      // A save that looks like it did nothing gets clicked again, and no
      // create action here is idempotent.
        router.refresh();
        onOk?.();
      } else {
        setError(result.error);
      }
    });
  }

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updatePrevailingWageRuleSet(ruleSet.id, formData), () => setMode("view"));
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-ink-label">{ruleSet.name}</p>
          <RuleSetFields defaults={ruleSet} />
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

  const current = ruleSet.effectiveFrom <= today && (ruleSet.effectiveTo === null || ruleSet.effectiveTo >= today);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{ruleSet.name}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body">
            {ruleSet.jurisdiction} · {authorityLabel(ruleSet.authority)}
          </span>
          {current ? (
            <span className="rounded bg-tag-green px-1.5 py-0.5 text-xs text-tag-green-ink">In force</span>
          ) : (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-muted">
              {ruleSet.effectiveTo && ruleSet.effectiveTo < today ? "Superseded" : "Not yet in force"}
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-ink-body">
          Daily OT {thresholdLabel(ruleSet.dailyOvertimeAfterHours)} · 2×{" "}
          {thresholdLabel(ruleSet.dailyDoubleTimeAfterHours)} · Weekly OT{" "}
          {thresholdLabel(ruleSet.weeklyOvertimeAfterHours)}
        </p>
        <p className="text-sm text-ink-body">
          7th straight day — OT {thresholdLabel(ruleSet.seventhDayOvertimeAfterHours)}, 2×{" "}
          {thresholdLabel(ruleSet.seventhDayDoubleTimeAfterHours)}
        </p>

        <p className="mt-1 text-xs text-ink-muted">
          {filingFrequencyLabel(ruleSet.filingFrequency)}
          {ruleSet.filingDueDays !== null && `, due ${ruleSet.filingDueDays} days after the period`}
          {ruleSet.formName && ` · ${ruleSet.formName}`}
          {` · in force from ${ruleSet.effectiveFrom}`}
          {ruleSet.effectiveTo ? ` to ${ruleSet.effectiveTo}` : ""}
        </p>

        <p className="text-xs text-ink-muted">
          {ruleSet.sourceUrl ? (
            <a href={ruleSet.sourceUrl} target="_blank" rel="noreferrer" className="text-link">
              Source
            </a>
          ) : (
            <span className="text-tag-amber-ink">No source recorded</span>
          )}
          {ruleSet.portalUrl && (
            <>
              {" · "}
              <a href={ruleSet.portalUrl} target="_blank" rel="noreferrer" className="text-link">
                Filing portal
              </a>
            </>
          )}
          {ruleSet.jobNames.length > 0 && ` · used on ${ruleSet.jobNames.join(", ")}`}
        </p>

        {ruleSet.note && <p className="mt-1 text-sm text-ink-body">{ruleSet.note}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Arming "Delete" empties this cluster, so "Edit" cannot be clicked
          by someone aiming for a cancel. This row was also the one place
          where "Edit" did NOT clear the armed flag, so leaving the edit form
          dropped you back onto a still-armed row; RowActions owns that state
          per-arming now and the inconsistency is gone.

          `pinned="end"` is new here (#184). This row sat in PINNED_EXCEPTIONS
          at the default — 100% overlap at 1100px, 72% at 375 — because no
          value was right at both widths. The armed column settles the phone,
          so `end` is now simply right: 0% at 1100, 639 and 375. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              pinned="end"
              confirmLabel="Confirm delete"
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => run(() => deletePrevailingWageRuleSet(ruleSet.id))}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
          Edit
        </button>
      </RowActions>
    </li>
  );
}
