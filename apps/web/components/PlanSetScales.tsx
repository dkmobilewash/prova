"use client";

import { useState, useTransition } from "react";
import { confirmSheetScales } from "@/lib/actions/takeoff";
import { CATEGORY_LABEL, CATEGORY_ORDER, type PlanSetRow, type ScaleConfidence } from "@/lib/takeoff/planSet";

/**
 * ── THE PLANS AND SCALE STEPS: the set sorted, each sheet's scale, and one press ──
 *
 * The guided flow's Phase 2. Every row is built from what the inventory and the
 * scale reader stored (`lib/takeoff/planSet.ts`). Confirm scales saves every
 * sheet the reader is sure of; the floor plans it is not sure of are listed
 * first, each with its one-click fix — the printed scale one sheet at a time,
 * because nothing on the sheet confirms it. Confirm scales never reaches those,
 * so the panel says they are still to do rather than leaving a confirmed set
 * with no floor plan in it.
 */
const MARK: Record<ScaleConfidence, { word: string; className: string }> = {
  set: { word: "Confirmed", className: "bg-tag-green text-tag-green-ink" },
  high: { word: "Sure", className: "bg-tag-green text-tag-green-ink" },
  printed: { word: "Printed only", className: "bg-tag-amber text-tag-amber-ink" },
  none: { word: "No scale", className: "bg-tag-rose text-tag-rose-ink" },
};

export function PlanSetScales({ jobId, planId, rows, reading }: { jobId: string; planId: string; rows: PlanSetRow[]; reading: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sure = rows.filter((row) => row.confidence === "high");
  const floors = rows.filter((row) => row.category === "floor");
  const floorsSet = floors.filter((row) => row.confidence === "set").length;
  const toLookAt = floors.filter((row) => row.confidence === "printed" || row.confidence === "none");
  const stillToDo = toLookAt.length === 0 ? "" : ` ${toLookAt.length} floor plan${toLookAt.length === 1 ? " is" : "s are"} still to do, below.`;

  function run(pages: number[], usePrinted: boolean) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await confirmSheetScales(jobId, planId, pages, usePrinted);
      if (!result.ok) return setError(result.error);
      const { confirmed, skipped } = result.value;
      const after = usePrinted ? "" : stillToDo;
      setMessage(`${confirmed} scale${confirmed === 1 ? "" : "s"} confirmed${skipped > 0 ? `; ${skipped} left for you to set` : ""}.${after}`);
    });
  }

  return (
    <section id="plan-set" data-takeoff="plan-set" className="scroll-mt-4 rounded-lg border border-line-card bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Your plan set</h2>
          <p className="text-sm text-ink-muted" data-takeoff="plan-set-summary">
            {rows.length} sheet{rows.length === 1 ? "" : "s"}
            {floors.length > 0 ? ` · ${floorsSet} of ${floors.length} floor plan${floors.length === 1 ? "" : "s"} scaled` : ""}
            {reading ? " · still reading the set" : ""}
          </p>
        </div>
        {/* Nothing sure left and floor plans to do: the header points at them
            rather than a dead Confirm scales. */}
        {sure.length === 0 && toLookAt.length > 0 ? (
          <a href="#plan-set-look" data-takeoff="plan-set-to-do" className="inline-flex min-h-[40px] items-center rounded-md border border-brand px-4 text-sm font-semibold text-ink hover:bg-rail-hover">
            {toLookAt.length} floor plan{toLookAt.length === 1 ? "" : "s"} still to do ↓
          </a>
        ) : (
        <button
          type="button"
          data-takeoff="confirm-scales"
          disabled={pending || sure.length === 0}
          onClick={() => run(sure.map((row) => row.pageNumber), false)}
          className="min-h-[40px] rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Confirming…" : sure.length > 0 ? `Confirm ${sure.length} scale${sure.length === 1 ? "" : "s"}` : "Confirm scales"}
        </button>
        )}
      </div>
      {sure.length > 0 && toLookAt.length > 0 && (
        <p className="mt-1 text-xs text-ink-muted" data-takeoff="plan-set-covers">
          Confirm covers the {sure.length} sheet{sure.length === 1 ? "" : "s"} the reader is sure of. The {toLookAt.length} floor plan{toLookAt.length === 1 ? "" : "s"} below need{toLookAt.length === 1 ? "s" : ""} their own.
        </p>
      )}
      {message && <p className="mt-2 text-sm text-tag-green-ink" data-takeoff="plan-set-message">{message}</p>}
      {error && <p className="mt-2 text-sm text-tag-rose-ink">{error}</p>}

      {toLookAt.length > 0 && (
        <div id="plan-set-look" className="mt-4 scroll-mt-4 rounded-md border border-line-card p-3" data-takeoff="plan-set-look">
          <h3 className="text-sm font-semibold text-ink">Floor plans that need a look ({toLookAt.length})</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {toLookAt.map((row) => (
              <li key={row.pageNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-takeoff="plan-set-fix" data-page={row.pageNumber}>
                <span className="font-medium text-ink">{name(row)}</span>
                <Mark row={row} />
                <span className="text-xs text-ink-muted">{row.why}</span>
                <span className="ml-auto flex gap-2">
                  {row.printedFix && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run([row.pageNumber], true)}
                      className="min-h-[32px] rounded-md border border-line-card px-2 text-xs text-ink-body hover:bg-rail-hover disabled:opacity-40"
                    >
                      Use the printed scale {row.scaleName}
                    </button>
                  )}
                  <a
                    href={`/takeoff/${jobId}?page=${row.pageNumber}&open=scale`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex min-h-[32px] items-center rounded-md border border-line-card px-2 text-xs text-ink-body hover:bg-rail-hover"
                  >
                    Set it by two clicks ↗
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {CATEGORY_ORDER.map((category) => {
          const group = rows.filter((row) => row.category === category);
          if (group.length === 0) return null;
          return (
            <details key={category} open={category === "floor"} className="rounded-md border border-line-card" data-takeoff="plan-set-group" data-category={category}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink-label">
                {CATEGORY_LABEL[category]} <span className="font-normal text-ink-muted">({group.length})</span>
              </summary>
              <ul className="flex flex-col divide-y divide-line-card px-3 pb-2">
                {group.map((row) => (
                  <li key={row.pageNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm" data-takeoff="plan-set-row" data-page={row.pageNumber} data-confidence={row.confidence}>
                    <span className="w-10 shrink-0 text-xs text-ink-muted">p{row.pageNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{name(row)}</span>
                    <span className="text-xs text-ink-body">{row.scaleName ?? "—"}</span>
                    <Mark row={row} />
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function name(row: PlanSetRow): string {
  return [row.number, row.title].filter(Boolean).join(" · ") || `Page ${row.pageNumber}`;
}

function Mark({ row }: { row: PlanSetRow }) {
  const mark = MARK[row.confidence];
  return (
    <span title={row.why} className={`rounded px-1.5 py-0.5 text-xs font-medium ${mark.className}`}>
      {mark.word}
    </span>
  );
}
