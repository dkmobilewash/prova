"use client";

import { useEffect, useState, useTransition } from "react";

import { Spinner } from "@/components/Spinner";
import { updateTakeoffItem } from "@/lib/actions";
import { ITEM_COLORS } from "@/lib/takeoff/itemColors";
import { type TakeoffItemRow, formatQuantity, itemQuantity } from "@/lib/takeoff/itemQuantities";

/**
 * ── THE SELECTED ITEM'S PROPERTIES, AND WHAT THEY DO TO ITS QUANTITY ──
 *
 * Height, sides, waste, thickness, spacing, depth. The panel's real job is the
 * line at the end: the quantity recomputed from what is typed, BEFORE it is
 * saved, so somebody can see 10 ft of wall become 198 sq ft of board and know
 * the figure is the one they meant.
 *
 * ── EACH FIELD SAVES ITSELF, AND ONLY ITSELF ──
 *
 * `updateTakeoffItem` is given a form carrying ONE key, and ignores anything
 * absent. So a save of the height cannot blank the thickness, and two people
 * on one item cannot overwrite each other's unrelated fields — which a
 * save-everything panel does by construction.
 *
 * ── WHICH FIELDS SHOW DEPENDS ON THE TYPE ──
 *
 * A count has no height and an area has no sides. Rendering every field for
 * every type would invite somebody to fill in a number that changes nothing,
 * and the properties panel is exactly where a figure that does nothing looks
 * most like a figure that does something.
 */

type Props = {
  jobId: string;
  item: TakeoffItemRow;
  readOnly?: boolean;
};

type FieldName = "heightFt" | "sides" | "thicknessIn" | "wastePercent" | "spacingIn" | "depthIn";

const FIELDS: { name: FieldName; label: string; suffix: string; forTypes: string[] }[] = [
  { name: "heightFt", label: "Height", suffix: "ft", forTypes: ["LINEAR", "SEGMENT"] },
  { name: "sides", label: "Sides", suffix: "", forTypes: ["LINEAR", "SEGMENT"] },
  { name: "thicknessIn", label: "Thickness", suffix: "in", forTypes: ["LINEAR", "SEGMENT"] },
  { name: "spacingIn", label: "Stud spacing", suffix: "in", forTypes: ["LINEAR", "SEGMENT"] },
  { name: "depthIn", label: "Depth", suffix: "in", forTypes: ["AREA", "AREA_WITH_PERIMETER"] },
  {
    name: "wastePercent",
    label: "Waste",
    suffix: "%",
    // Every type but COUNT. You do not buy 1.1 doors, and
    // `itemQuantities.ts` refuses to apply it to a count — so offering the
    // field would be offering a number that silently does nothing.
    forTypes: ["LINEAR", "SEGMENT", "AREA", "AREA_WITH_PERIMETER"],
  },
];

export function TakeoffItemProperties({ jobId, item, readOnly = false }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A different item is a different set of values; the draft must not follow
  // somebody from one condition to the next.
  useEffect(() => setDraft({}), [item.id]);

  const valueOf = (name: FieldName): string => {
    if (name in draft) return draft[name];
    const stored = item[name];
    return stored === null || stored === undefined ? "" : String(stored);
  };

  /**
   * The quantity as it WOULD be, from what is on screen rather than what is
   * stored. This is the panel's reason to exist — `itemQuantity` is the same
   * function the rail and the estimate use, so the preview cannot drift from
   * the real figure.
   */
  const preview = itemQuantity(item.measurements, {
    type: item.type,
    heightFt: Number(valueOf("heightFt")) || null,
    sides: Number(valueOf("sides")) || null,
    wastePercent: Number(valueOf("wastePercent")) || null,
    depthIn: Number(valueOf("depthIn")) || null,
  });

  function save(name: FieldName, value: string) {
    setError(null);
    const form = new FormData();
    form.set(name, value);
    startTransition(async () => {
      const result = await updateTakeoffItem(jobId, item.id, form);
      if (!result.ok) setError(result.error);
    });
  }

  function saveName(value: string) {
    setError(null);
    const form = new FormData();
    form.set("name", value);
    startTransition(async () => {
      const result = await updateTakeoffItem(jobId, item.id, form);
      if (!result.ok) setError(result.error);
    });
  }

  const fields = FIELDS.filter((field) => field.forTypes.includes(item.type));

  return (
    <div className="flex flex-col gap-1.5" data-takeoff="item-properties" data-item={item.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-sm border border-line-card"
          style={{ backgroundColor: item.colorHex }}
        />
        <input
          defaultValue={item.name}
          key={item.id}
          disabled={readOnly}
          onBlur={(event) => {
            if (event.target.value.trim() !== item.name) saveName(event.target.value);
          }}
          // A LITERAL `name`, so the numeric census can read it and tell that
          // this is text. Without one it reads as "unnamed", which that file
          // treats as "might be numeric" and requires an inputMode for —
          // correctly, since an unreadable name is not evidence of anything.
          name="name"
          aria-label="Item name"
          data-takeoff="item-name"
          className="min-w-0 flex-1 rounded-md border border-line-card bg-surface px-2 py-0.5 text-xs font-semibold text-ink"
        />
        {!readOnly && (
          <div className="flex items-center gap-1" data-takeoff="item-colors">
            {ITEM_COLORS.slice(0, 6).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  const form = new FormData();
                  form.set("colorHex", color);
                  startTransition(async () => {
                    const result = await updateTakeoffItem(jobId, item.id, form);
                    if (!result.ok) setError(result.error);
                  });
                }}
                aria-label={`Colour this item ${color}`}
                className={
                  "h-4 w-4 rounded-sm border" +
                  (color.toLowerCase() === item.colorHex.toLowerCase()
                    ? " border-ink"
                    : " border-line-card")
                }
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
        {pending && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
            <Spinner />
            Saving…
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        {fields.map((field) => (
          <label key={field.name} className="flex flex-col text-[10px] text-ink-muted">
            {field.label}
            {field.suffix ? ` (${field.suffix})` : ""}
            <input
              // `decimal-pad` for the phone, and `inputMode` rather than
              // `type="number"`: a number input SILENTLY BLANKS a value the
              // browser dislikes, which on a threshold field means billing
              // somebody at the default. Measured in real Chromium; see the
              // openings-deduction entry in CLAUDE.md.
              inputMode="decimal"
              value={valueOf(field.name)}
              disabled={readOnly}
              onChange={(event) => setDraft((was) => ({ ...was, [field.name]: event.target.value }))}
              onBlur={(event) => {
                const stored = item[field.name];
                const before = stored === null || stored === undefined ? "" : String(stored);
                if (event.target.value.trim() !== before) save(field.name, event.target.value);
              }}
              data-takeoff={`prop-${field.name}`}
              className="mt-0.5 w-20 rounded-md border border-line-card bg-surface px-1.5 py-0.5 text-xs text-ink"
            />
          </label>
        ))}

        <div className="ml-auto text-right">
          <span className="block text-[10px] uppercase tracking-wide text-ink-muted">Quantity</span>
          <span className="text-sm font-semibold text-ink" data-takeoff="item-preview">
            {formatQuantity(preview)}
          </span>
          {preview.faceSqFt > 0 && (
            <span className="ml-2 text-[11px] text-ink-body" data-takeoff="item-face">
              {preview.faceSqFt.toLocaleString("en-US", { maximumFractionDigits: 0 })} sq ft of face
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-tag-rose-ink" role="alert" data-takeoff="property-error">
          {error}
        </p>
      )}
    </div>
  );
}
