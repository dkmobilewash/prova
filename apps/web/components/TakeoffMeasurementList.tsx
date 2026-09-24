"use client";

import { useMemo, useState, useTransition } from "react";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteTakeoffMeasurement, postTakeoffMeasurements, rescaleTakeoffMeasurements } from "@/lib/actions";
import { measurementPrimitive, type StoredMeasurement } from "@/lib/takeoff-plan";
import type { PlanMeasurementRow, PlanSheet } from "@/lib/takeoff-plan-view";
import { RECIPES } from "@/lib/takeoff-recipes";

/**
 * What has been measured, and the one control that turns it into a bid.
 *
 * EVERY FIGURE ON THIS SCREEN IS DERIVED, by the same `measurementPrimitive`
 * the Server Action runs — so what a person reads here and what gets written
 * are the same computation over the same stored numbers, not two that agree
 * by inspection. The form posts IDS. There is nowhere in it for a quantity.
 */

/** Which recipes a traced shape can feed. `ceiling` is deliberately absent:
 * a polygon has an area, not a length and a width, and inventing them from a
 * bounding box is the guess this codebase refuses. */
const PLAN_RECIPES = RECIPES.filter((recipe) => recipe.id !== "ceiling");

const KIND_LABEL: Record<string, string> = { LINEAR: "Line", AREA: "Area", COUNT: "Count" };

function reads(row: PlanMeasurementRow): string {
  const stored: StoredMeasurement = {
    kind: row.kind,
    xs: row.xs,
    ys: row.ys,
    label: row.label,
    calibration: row.calibration,
  };
  const primitive = measurementPrimitive(stored);
  if (!primitive) return "can't be measured";
  if (primitive.kind === "linear") return `${primitive.feet.toFixed(1)} ft`;
  if (primitive.kind === "area") return `${Math.round(primitive.squareFeet)} sq ft`;
  return `${primitive.count} × ${primitive.item}`;
}

export function TakeoffMeasurementList({ jobId, sheet }: { jobId: string; sheet: PlanSheet }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [recipe, setRecipe] = useState(PLAN_RECIPES[0]?.id ?? "wall");

  const unposted = sheet.measurements.filter((m) => !m.postedAt);
  const outOfDate = unposted.filter((m) => m.outOfDate);
  const chosen = useMemo(
    () => sheet.measurements.filter((m) => selected.includes(m.id)),
    [sheet.measurements, selected],
  );

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const remove = (measurementId: string) => {
    setRowError(null);
    startTransition(async () => {
      const result = await deleteTakeoffMeasurement(jobId, measurementId);
      if (result && !result.ok) setRowError(result.error);
      else setSelected((current) => current.filter((id) => id !== measurementId));
    });
  };

  if (sheet.measurements.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing measured on this sheet yet. Pick a tool above and click along what you&rsquo;re taking off.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {outOfDate.length > 0 && (
        <div className="rounded-lg border border-line-row bg-amber-500/5 p-3">
          <p className="text-sm text-tag-amber-ink">
            {outOfDate.length === 1 ? "One measurement reads" : `${outOfDate.length} measurements read`} at an older
            scale for this sheet.
          </p>
          <p className="mt-1 text-xs text-ink-body">
            Nothing moved on its own — each one still reads at the scale it was drawn to. Moving them to the current
            scale changes the figures below, and leaves anything already added to the estimate alone.
          </p>
          <ActionForm action={rescaleTakeoffMeasurements.bind(null, jobId)} className="mt-2">
            <input type="hidden" name="pageId" value={sheet.id} />
            <SubmitButton
              type="submit"
              className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
            >
              Move them to the current scale
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line-row rounded-lg border border-line-card">
        {sheet.measurements.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 p-2">
            <label className="flex min-w-0 items-center gap-2 text-sm text-ink-body">
              <input
                type="checkbox"
                className="accent-yellow-500"
                checked={selected.includes(row.id)}
                disabled={Boolean(row.postedAt)}
                onChange={() => toggle(row.id)}
              />
              <span className="truncate">
                <span className="text-ink-muted">{KIND_LABEL[row.kind]}</span>{" "}
                {row.label ?? <span className="text-ink-muted">unnamed</span>} —{" "}
                <span className="font-medium">{reads(row)}</span>
                {row.outOfDate && !row.postedAt && <span className="ml-2 text-xs text-tag-amber-ink">older scale</span>}
                {row.postedAt && <span className="ml-2 text-xs text-ink-muted">already on the estimate</span>}
              </span>
            </label>
            <RowActions
              className="flex shrink-0 items-center gap-2"
              destructive={
                <ConfirmDelete
                  label="Delete"
                  describe={`Removes this ${KIND_LABEL[row.kind].toLowerCase()} measurement from the sheet. Anything already added to the estimate stays on it.`}
                  confirmLabel="Confirm delete"
                  pendingLabel="Deleting…"
                  pending={isPending}
                  // Right-pinned cluster, so Cancel renders LAST and inherits
                  // the pixel the delete button vacated.
                  pinned="end"
                  onConfirm={() => remove(row.id)}
                />
              }
            />
          </li>
        ))}
      </ul>

      {rowError && (
        <p role="alert" className="text-sm text-tag-rose-ink">
          {rowError}
        </p>
      )}

      <ActionForm
        action={postTakeoffMeasurements.bind(null, jobId)}
        className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface-card p-3"
        onSuccess={() => setSelected([])}
      >
        {chosen.map((row) => (
          <input key={row.id} type="hidden" name="measurementId" value={row.id} />
        ))}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Add as
            <select
              name="recipe"
              value={recipe}
              onChange={(event) => setRecipe(event.target.value)}
              className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            >
              {PLAN_RECIPES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Name these lines
            <input
              name="label"
              placeholder={sheet.label ?? "Level 1"}
              className="w-44 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
          </label>
        </div>

        {recipe === "wall" && <WallBridgeFields />}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            type="submit"
            disabled={chosen.length === 0}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
          >
            Add {chosen.length === 0 ? "to the estimate" : `${chosen.length} to the estimate`}
          </SubmitButton>
          <p className="text-xs text-ink-muted">
            Quantities are worked out on the server from the shapes and the sheet&rsquo;s scale — nothing on this
            screen is sent as a number. Lines are added unpriced.
          </p>
        </div>
      </ActionForm>
    </div>
  );
}

/** The two things a wall needs that a drawing does not carry, plus the
 * openings to deduct. The height is typed once and applies to every run
 * selected, because the runs are summed into one wall. */
function WallBridgeFields() {
  const [openings, setOpenings] = useState<{ w: string; h: string }[]>([]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line-row p-2">
      <p className="text-xs text-ink-muted">
        A drawing carries the run, not the height. Every line you picked is added together into one wall.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Wall height (ft)
          <input
            name="heightFt"
            inputMode="decimal"
            placeholder="9"
            className="w-24 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Boarded
          <select
            name="sides"
            defaultValue="2"
            className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          >
            <option value="2">Both sides</option>
            <option value="1">One side</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Stud spacing (in)
          <input
            name="spacingIn"
            inputMode="decimal"
            placeholder="16"
            className="w-24 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Waste (%)
          <input
            name="wastePercent"
            inputMode="decimal"
            placeholder="10"
            className="w-20 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <button
          type="button"
          onClick={() => setOpenings((current) => [...current, { w: "", h: "" }])}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Add an opening
        </button>
      </div>

      {openings.map((opening, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Opening width (ft)
            <input
              name="openingWidth"
              inputMode="decimal"
              value={opening.w}
              onChange={(event) =>
                setOpenings((current) =>
                  current.map((o, i) => (i === index ? { ...o, w: event.target.value } : o)),
                )
              }
              className="w-24 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Opening height (ft)
            <input
              name="openingHeight"
              inputMode="decimal"
              value={opening.h}
              onChange={(event) =>
                setOpenings((current) =>
                  current.map((o, i) => (i === index ? { ...o, h: event.target.value } : o)),
                )
              }
              className="w-24 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
          </label>
          <button
            type="button"
            onClick={() => setOpenings((current) => current.filter((_, i) => i !== index))}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
