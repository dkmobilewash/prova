"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyRevisedSheets, undoSheetSuggestions, type SheetSuggestionsUndo } from "@/lib/actions";

/**
 * Apply the addendum's sheets to the takeoff (`applyRevisedSheets`), say what moved,
 * and offer Undo (the queue's own `undoSheetSuggestions`). The GC's summary sits
 * beside it, with Copy: it is plain text, made from the same rows as the table.
 * The Undo token lives in this tab, like every other Undo in the takeoff.
 */
export function RevisedSheetsActions({ jobId, summary, canApply }: { jobId: string; summary: string; canApply: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // The summary as it stood when applied: after it, the page's rows are the takeoff's, and say nothing changed.
  const [applied, setApplied] = useState<{ text: string; undo: SheetSuggestionsUndo; summary: string } | null>(null);
  const shown = applied?.summary ?? summary;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const button = "min-h-[36px] rounded-md border border-line-card px-3 text-sm font-medium text-ink-body hover:bg-rail disabled:opacity-50";

  return (
    <section className="mt-6 flex flex-col gap-4" data-addendum="actions">
      <div className="flex flex-wrap items-center gap-2">
        {canApply && applied === null && (
          <button
            type="button"
            className={`${button} border-brand bg-brand font-semibold text-neutral-900`}
            disabled={pending}
            data-addendum="apply"
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await applyRevisedSheets(jobId);
                if (!result.ok) return setError(result.error);
                const v = result.value;
                const change = `${v.priceChange > 0 ? "+" : v.priceChange < 0 ? "−" : ""}${Math.abs(v.priceChange).toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
                setApplied({ summary: v.summary, text: `Applied: ${v.moved + v.written} revised walls on the takeoff (${v.written} written, ${v.moved} retyped), ${v.replaced} replaced walls taken off the estimate. The estimate moved ${change}.`, undo: v.undo });
                router.refresh();
              })
            }
          >
            Apply to the takeoff
          </button>
        )}
        {applied !== null && (
          <>
            <span className="text-sm text-ink-body" data-addendum="applied">
              {applied.text}
            </span>
            <button
              type="button"
              className={button}
              disabled={pending}
              data-addendum="undo"
              onClick={() =>
                start(async () => {
                  const back = await undoSheetSuggestions(jobId, applied.undo);
                  if (!back.ok) return setError(back.error);
                  setApplied(null);
                  router.refresh();
                })
              }
            >
              Undo
            </button>
          </>
        )}
        {error !== null && (
          <span role="alert" className="text-sm text-tag-rose-ink">
            {error}
          </span>
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">To send the GC</h2>
          <button
            type="button"
            className={button}
            data-addendum="copy-summary"
            onClick={() => {
              void navigator.clipboard?.writeText(shown).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <textarea readOnly value={shown} rows={Math.min(14, shown.split("\n").length + 1)} className="w-full rounded-md border border-line-card bg-surface p-2 font-mono text-xs text-ink-body" data-addendum="summary" />
      </div>
    </section>
  );
}
