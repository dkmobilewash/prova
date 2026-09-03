"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePrevailingWageRuleSet, updatePrevailingWageRuleSet } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { RuleSetFields, type RuleSetDefaults } from "@/components/RuleSetFields";
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
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

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
  const [confirming, setConfirming] = useState(false);
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
          <p className="text-sm font-semibold text-slate-300">{ruleSet.name}</p>
          <RuleSetFields defaults={ruleSet} />
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

  const current = ruleSet.effectiveFrom <= today && (ruleSet.effectiveTo === null || ruleSet.effectiveTo >= today);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-100">{ruleSet.name}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
            {ruleSet.jurisdiction} · {authorityLabel(ruleSet.authority)}
          </span>
          {current ? (
            <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-300">In force</span>
          ) : (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-500">
              {ruleSet.effectiveTo && ruleSet.effectiveTo < today ? "Superseded" : "Not yet in force"}
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-slate-400">
          Daily OT {thresholdLabel(ruleSet.dailyOvertimeAfterHours)} · 2×{" "}
          {thresholdLabel(ruleSet.dailyDoubleTimeAfterHours)} · Weekly OT{" "}
          {thresholdLabel(ruleSet.weeklyOvertimeAfterHours)}
        </p>
        <p className="text-sm text-slate-400">
          7th straight day — OT {thresholdLabel(ruleSet.seventhDayOvertimeAfterHours)}, 2×{" "}
          {thresholdLabel(ruleSet.seventhDayDoubleTimeAfterHours)}
        </p>

        <p className="mt-1 text-xs text-slate-500">
          {filingFrequencyLabel(ruleSet.filingFrequency)}
          {ruleSet.filingDueDays !== null && `, due ${ruleSet.filingDueDays} days after the period`}
          {ruleSet.formName && ` · ${ruleSet.formName}`}
          {` · in force from ${ruleSet.effectiveFrom}`}
          {ruleSet.effectiveTo ? ` to ${ruleSet.effectiveTo}` : ""}
        </p>

        <p className="text-xs text-slate-500">
          {ruleSet.sourceUrl ? (
            <a href={ruleSet.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-400">
              Source
            </a>
          ) : (
            <span className="text-amber-300">No source recorded</span>
          )}
          {ruleSet.portalUrl && (
            <>
              {" · "}
              <a href={ruleSet.portalUrl} target="_blank" rel="noreferrer" className="text-blue-400">
                Filing portal
              </a>
            </>
          )}
          {ruleSet.jobNames.length > 0 && ` · used on ${ruleSet.jobNames.join(", ")}`}
        </p>

        {ruleSet.note && <p className="mt-1 text-sm text-slate-400">{ruleSet.note}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
          Edit
        </button>
        {canDelete &&
          (confirming ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deletePrevailingWageRuleSet(ruleSet.id), () => setConfirming(false))}
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setConfirming(false)} className={btn}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setConfirming(true);
                setError(null);
              }}
              className={btn}
            >
              Delete
            </button>
          ))}
      </div>
    </li>
  );
}
