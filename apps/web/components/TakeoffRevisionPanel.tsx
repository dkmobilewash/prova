"use client";

import { Spinner } from "@/components/Spinner";
import type { RevisionCompare } from "@/lib/actions/takeoffRevisions";

/** The colours the overlay draws in, named here so the legend and the lines cannot disagree. */
export const ADDED_COLOUR = "#16a34a";
export const REMOVED_COLOUR = "#dc2626";

/** The changes drawn over the sheet, inside the viewer's page-width SVG: removed dashed, added solid. */
export function RevisionOverlay({ result, strokePx }: { result: Pick<RevisionCompare, "added" | "removed">; strokePx: number }) {
  return (
    <g data-takeoff="revision-overlay">
      {result.removed.map((s, i) => <line key={`r${i}`} data-change="removed" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={REMOVED_COLOUR} strokeWidth={strokePx} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />)}
      {result.added.map((s, i) => <line key={`a${i}`} data-change="added" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={ADDED_COLOUR} strokeWidth={strokePx} vectorEffect="non-scaling-stroke" />)}
    </g>
  );
}

/** What changed since the earlier version of this sheet, and what to do about it. */
export function TakeoffRevisionPanel({
  state,
  onFindWalls,
  findDisabled,
  findWhy = null,
  onRunAnyway,
  scaleOffer,
  onFindRooms,
  roomsDisabled,
  onClear,
}: {
  state: { earlier: string; busy: boolean; error: string | null; result: RevisionCompare | null };
  onFindWalls: () => void;
  findDisabled: boolean;
  /**
   * Why Find the walls cannot run, the toolbar's own sentence. Round 6 pressed
   * the button on a sheet with no scale that was also classed as unit numbering,
   * and nothing happened and nothing said why.
   */
  findWhy?: string | null;
  /** Present when the sheet was classed as not worth measuring: the toolbar's "Run anyway". */
  onRunAnyway?: () => void;
  /** Present when the sheet has no scale and prints one: the toolbar's "Use the printed scale". */
  scaleOffer?: { label: string; onUse: () => void };
  /** Absent when the company has room finding off. */
  onFindRooms?: () => void;
  roomsDisabled?: boolean;
  onClear: () => void;
}) {
  if (state.busy) return <p className="mb-2 flex items-center gap-2 rounded-lg border border-line-card bg-surface p-3 text-xs text-ink-body"><Spinner /> Laying this sheet over {state.earlier}…</p>;
  if (state.error || state.result === null) return <p className="mb-2 rounded-lg border border-line-card bg-surface p-3 text-xs text-tag-rose-ink" data-takeoff="revision-error">{state.error ?? "The two versions could not be compared."}</p>;
  const r = state.result;
  const none = !r.truncated && r.added.length === 0 && r.removed.length === 0;
  return (
    <div data-takeoff="revision-panel" className="mb-2 rounded-lg border border-line-card bg-surface p-3 text-xs">
      <p className="text-sm font-medium text-ink">Compared with {r.earlier}</p>
      {none ? (
        <p className="mt-1 text-ink-body">No line work changed.</p>
      ) : r.truncated ? (
        <p className="mt-1 text-ink-body" data-takeoff="revision-redrawn">
          Too much changed to draw: {Math.round(r.agreement * 100)}% of this sheet&apos;s lines are where they were. It was probably re-drawn or laid out again, so check it by eye.
        </p>
      ) : (
        <p className="mt-1 flex flex-wrap gap-x-3 text-ink-body">
          <span><span className="inline-block h-0.5 w-4 align-middle" style={{ background: ADDED_COLOUR }} /> {r.added.length} added</span>
          <span><span className="inline-block h-0.5 w-4 border-t-2 border-dashed align-middle" style={{ borderColor: REMOVED_COLOUR }} /> {r.removed.length} removed</span>
          <span className="text-ink-muted">{Math.round(r.agreement * 100)}% unchanged</span>
        </p>
      )}
      {r.changedItems.length > 0 ? (
        <div className="mt-2" data-takeoff="revision-items">
          <p className="font-medium text-ink">Measured on the earlier version, through a change:</p>
          <ul className="mt-0.5 list-disc pl-4 text-ink-body">
            {r.changedItems.map((i) => (
              <li key={i.name}>
                {i.name}: {i.changed} of {i.total} measurement{i.total === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-ink-muted">No takeoff measured on the earlier version runs through a change.</p>
      )}
      {findWhy && (
        <p className="mt-2 text-ink-muted" data-takeoff="revision-find-why">
          {findWhy}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onFindWalls}
          disabled={findDisabled}
          title={findWhy ?? undefined}
          data-takeoff="revision-find-walls"
          className="min-h-[36px] rounded-md border border-line-card bg-brand px-3 text-xs font-medium text-neutral-900 hover:bg-brand-hover disabled:opacity-40"
        >
          Find the walls on this version
        </button>
        {onFindRooms && (
          <button
            type="button"
            onClick={onFindRooms}
            disabled={roomsDisabled}
            data-takeoff="revision-find-rooms"
            title={roomsDisabled ? "Find the walls first — rooms are what they enclose." : undefined}
            className="min-h-[36px] rounded-md border border-line-card px-3 text-xs text-ink-body disabled:opacity-40"
          >
            Find the rooms
          </button>
        )}
        {scaleOffer && (
          <button type="button" onClick={scaleOffer.onUse} data-takeoff="revision-scale-offer" className="min-h-[36px] rounded-md border border-line-card px-3 text-xs text-ink-body">
            {scaleOffer.label}
          </button>
        )}
        {onRunAnyway && (
          <button type="button" onClick={onRunAnyway} data-takeoff="revision-run-anyway" className="min-h-[36px] rounded-md border border-line-card px-3 text-xs text-link hover:text-link-hover">
            Run anyway
          </button>
        )}
        <button type="button" onClick={onClear} data-takeoff="revision-clear" className="min-h-[36px] rounded-md border border-line-card px-3 text-xs text-ink-body">
          Hide the comparison
        </button>
      </div>
    </div>
  );
}
