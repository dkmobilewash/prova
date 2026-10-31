"use client";

type Kind = "EXCLUDE_LIKE" | "WORK_AREA";

/**
 * The sheet's wall total and what the estimator took out of it. On the page and
 * not in the Quantities panel, which starts closed on any window under 1440 px:
 * a person who has just removed walls must see the number move and a way back.
 */
export function TakeoffExclusionBar({
  feet,
  aside,
  excludes,
  workAreas,
  readOnly,
  onUndo,
  onClear,
}: {
  /** Null until this sheet's walls have been found. */
  feet: number | null;
  aside: readonly { kind: string; why: string; n: number }[];
  excludes: number;
  workAreas: number;
  readOnly: boolean;
  onUndo: (kind: Kind) => void;
  onClear: (kind: Kind) => void;
}) {
  if (feet === null && excludes === 0 && workAreas === 0) return null;
  const control = "underline hover:text-ink-body";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted" data-takeoff="exclusion-bar">
      {feet !== null && (
        <span className="font-semibold text-ink-body" data-takeoff="wall-total">
          Walls on this sheet: {Math.round(feet).toLocaleString()} ft
        </span>
      )}
      {aside.map((one) => (
        <span key={one.kind} className="flex flex-wrap items-center gap-2" data-takeoff={one.kind}>
          <span>
            {one.n} wall{one.n === 1 ? "" : "s"} {one.why}.
          </span>
          {!readOnly && (
            <button type="button" className={control} onClick={() => onUndo(one.kind === "excluded-like" ? "EXCLUDE_LIKE" : "WORK_AREA")}>
              Undo
            </button>
          )}
        </span>
      ))}
      {!readOnly && excludes > 0 && (
        <button type="button" className={control} data-takeoff="clear-exclusions" onClick={() => onClear("EXCLUDE_LIKE")}>
          Clear exclusions
        </button>
      )}
      {!readOnly && workAreas > 0 && (
        <button type="button" className={control} data-takeoff="remove-work-area" onClick={() => onClear("WORK_AREA")}>
          Remove work area
        </button>
      )}
    </div>
  );
}
