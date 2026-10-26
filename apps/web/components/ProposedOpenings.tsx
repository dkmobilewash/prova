"use client";

import { useId, useState } from "react";

import { openingPairs, type OpeningPick } from "@/lib/takeoff/openingPicks";

/**
 * "2 doors and 1 window drawn in these walls — add them", under a found-walls
 * group.
 *
 * PROPOSED, like the group it sits under: nothing here reaches the estimate
 * until a person types a height, because the drawing does not carry one and
 * the app will not invent it (see `openingPicks.ts`). The rows ride along with
 * the group's own Add button — there is no second submit — so accepting the
 * group and its openings is one decision, made once.
 *
 * Only a PRICED group carries them. An unpriced accept writes bare
 * measurements, which have nowhere to keep an opening, so the rows say so
 * instead of collecting heights that would be thrown away — the same honesty
 * as the button's own "not priced yet".
 */
export function ProposedOpenings({
  sentence,
  picks,
  onChange,
  carried,
}: {
  sentence: string;
  picks: OpeningPick[];
  onChange: (next: OpeningPick[]) => void;
  /** Whether the group's Add button will post them — true when it is priced. */
  carried: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { pairs, waiting, problems } = openingPairs(picks);
  const set = (index: number, patch: Partial<OpeningPick>) =>
    onChange(picks.map((pick, i) => (i === index ? { ...pick, ...patch } : pick)));

  return (
    <div className="w-full text-xs" data-takeoff="proposed-openings">
      <p className="text-ink-body">
        {sentence}
        {" — "}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className="min-h-[36px] text-link underline hover:text-link-hover"
        >
          {open ? "hide" : "add them"}
        </button>
      </p>
      {open && (
        <div id={listId} className="mt-1 flex flex-col gap-2 rounded-md border border-line-row p-2">
          {carried ? (
            <p className="text-ink-muted">
              Read off the drawing: the width is measured between the jambs, the height is not on a plan. Type a
              height for each one you want; it goes on with this group and your opening-deduction setting decides
              whether it comes off. A row with no height is left off.
            </p>
          ) : (
            <p className="text-tag-amber-ink">
              These walls are going on without a priced wall type, so there is no wall run to carry openings yet.
              Add them when you put these lines on the estimate.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {picks.map((pick, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <label className="flex min-h-[36px] items-center gap-2 text-ink-body">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-yellow-500"
                    checked={pick.keep}
                    disabled={!carried}
                    onChange={(event) => set(index, { keep: event.target.checked })}
                  />
                  {pick.kind === "door" ? (pick.leaves === 2 ? "Pair of doors" : "Door") : "Window"}
                </label>
                <label className="flex flex-col gap-1 text-ink-label">
                  Width (ft)
                  <input
                    inputMode="decimal"
                    value={pick.width}
                    disabled={!carried}
                    onChange={(event) => set(index, { width: event.target.value })}
                    className="w-20 rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
                  />
                </label>
                <label className="flex flex-col gap-1 text-ink-label">
                  Height (ft)
                  <input
                    inputMode="decimal"
                    value={pick.height}
                    placeholder="from the schedule"
                    disabled={!carried}
                    onChange={(event) => set(index, { height: event.target.value })}
                    className="w-32 rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
                  />
                </label>
              </li>
            ))}
          </ul>
          {carried && (
            <p className="text-ink-muted" data-takeoff="proposed-openings-status">
              {pairs.length === 0
                ? "None will be added yet — no height typed."
                : `${pairs.length} will be added with this group.`}
              {waiting > 0 && pairs.length > 0 ? ` ${waiting} still need a height and will be left off.` : ""}
            </p>
          )}
          {problems.map((problem) => (
            <p key={problem} role="alert" className="text-tag-rose-ink">
              {problem}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
