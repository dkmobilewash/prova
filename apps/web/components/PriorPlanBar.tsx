"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePriorPlanChoice, suggestPriorPlanChoice } from "@/lib/actions";
import type { Pairing } from "@/lib/takeoff/priorPlan";

/** What plan comparison did on the sheet last found. `pairing` null: nothing paired. `why`: paired, not applied. */
export type PriorStatus = { page: number; pairing: Pairing | null; sheet: string | null; n: number; feet: number; why: string | null };

type Sheet = { pageNumber: number; sheetNumber: string | null; title: string | null };

const BASIS: Record<string, string> = {
  "sheet-number": "paired by sheet number",
  title: "paired by title",
  grid: "paired by its drawing",
  chosen: "chosen by you",
};

/**
 * ── WHICH DEMOLITION PLAN THIS SHEET IS COMPARED WITH, AND WHAT IT DID ──
 *
 * Plan comparison sets walls aside, so the pairing behind it is never hidden:
 * the sheet says which demolition plan it used and how it was chosen, what it
 * set aside or why it set nothing aside, and lets the estimator pick another
 * sheet, remove the pairing, or go back to the automatic one. See
 * `lib/takeoff/priorPlan.ts`.
 */
export function PriorPlanBar({
  status,
  sheets,
  pageNumber,
  jobId,
  planId,
  readOnly,
}: {
  status: PriorStatus;
  sheets: readonly Sheet[];
  pageNumber: number;
  jobId: string;
  planId: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const choose = (choice: "auto" | "none" | number) =>
    start(async () => {
      setError(null);
      const saved = await savePriorPlanChoice({ jobId, planId, pageNumber, choice });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setChanged(true);
      router.refresh();
    });
  // ── NOTHING PAIRED: OFFER THE DEMOLITION PLAN THAT LINES UP (`suggestPriorPlan`) ──
  // Asked once per unpaired sheet; shown only when the drawings line up, and
  // applied only by the person's click — as their own choice.
  const [suggestion, setSuggestion] = useState<{ page: number; demoPage: number; sheet: string } | null>(null);
  const unpaired = status.pairing === null && !readOnly;
  useEffect(() => {
    if (!unpaired) return;
    let live = true;
    suggestPriorPlanChoice({ jobId, planId, pageNumber }).then(
      (r) => {
        if (live && r.ok && r.value !== null) setSuggestion({ page: pageNumber, demoPage: r.value.demoPage, sheet: r.value.sheet });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [unpaired, jobId, planId, pageNumber]);
  const offer = unpaired && !changed && suggestion !== null && suggestion.page === pageNumber ? suggestion : null;
  const name = (s: Sheet) => `${s.sheetNumber ?? `Page ${s.pageNumber}`}${s.title ? ` — ${s.title}` : ""}`;
  const others = sheets.filter((s) => s.pageNumber !== pageNumber);
  const p = status.pairing;
  return (
    <div data-takeoff="prior-plan" className="shrink-0 space-y-1 text-xs text-ink-body">
      {p === null ? (
        <>
          <p data-takeoff="prior-plan-none">No demolition plan is paired with this sheet, so no wall is compared.</p>
          {offer !== null && (
            <p data-takeoff="prior-plan-suggest" className="flex flex-wrap items-center gap-2">
              <span>
                Demolition plan <span className="font-medium text-ink">{offer.sheet}</span> lines up with this sheet. Compare with {offer.sheet}?
              </span>
              <button type="button" data-takeoff="prior-plan-accept" disabled={pending} onClick={() => choose(offer.demoPage)} className="min-h-[44px] rounded border border-line-card px-3 text-xs text-ink hover:bg-surface">
                Compare with {offer.sheet}
              </button>
            </p>
          )}
        </>
      ) : (
        <p data-takeoff="prior-plan-paired">
          Compared with demolition plan <span className="font-medium text-ink">{status.sheet}</span> ({BASIS[p.basis] ?? "paired automatically"}).{" "}
          {status.why !== null ? (
            <span data-takeoff="prior-plan-why">Not applied: {status.why}.</span>
          ) : (
            <span data-takeoff="prior-plan-aside">
              {status.n === 0
                ? "No wall here is on it."
                : `${status.n} wall${status.n === 1 ? "" : "s"}, ${Math.round(status.feet).toLocaleString()} ft, set aside as existing to remain.`}
            </span>
          )}
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-ink-muted">{p === null ? "Compare with" : "Change to"}</span>
            <select
              data-takeoff="prior-plan-pick"
              disabled={pending}
              value=""
              onChange={(event) => {
                const page = Number(event.target.value);
                if (page > 0) choose(page);
              }}
              className="min-h-[44px] rounded border border-line-card bg-canvas px-2 text-xs text-ink"
            >
              <option value="">a sheet of this set…</option>
              {others.map((s) => (
                <option key={s.pageNumber} value={s.pageNumber}>
                  {name(s)}
                </option>
              ))}
            </select>
          </label>
          {p !== null && (
            <button type="button" data-takeoff="prior-plan-remove" disabled={pending} onClick={() => choose("none")} className="min-h-[44px] rounded border border-line-card px-3 text-xs text-ink hover:bg-surface">
              Remove pairing
            </button>
          )}
          {(p === null || p.source === "user") && (
            <button type="button" data-takeoff="prior-plan-auto" disabled={pending} onClick={() => choose("auto")} className="min-h-[44px] rounded border border-line-card px-3 text-xs text-ink hover:bg-surface">
              Use automatic pairing
            </button>
          )}
        </div>
      )}
      {changed && !error && <p className="text-ink-muted">Saved. Find the walls again to compare with it.</p>}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}
