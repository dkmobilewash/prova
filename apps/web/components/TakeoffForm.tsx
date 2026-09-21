"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addTakeoffLines } from "@/lib/actions";
import { recipeLines, RECIPES, type RecipeInput, type RecipeArgs } from "@/lib/takeoff-recipes";

/**
 * Measured dimensions in, priced-later line items out — for every recipe.
 *
 * THE PREVIEW IS THE POINT. An estimator will not trust quantities that
 * appear in a bid without having seen them first, and they are right not to
 * — a takeoff tool that computes silently is one whose arithmetic nobody
 * ever checks. So the same pure `recipeLines` runs here as you type, and the
 * numbers are on screen before anything is saved.
 *
 * The server recomputes them from the dimensions and ignores whatever this
 * preview produced. That is not distrust of this component; it is that a
 * quantity posted from a browser is a number the browser chose, and these
 * end up in a bid.
 *
 * It does not measure anything. Somebody measures — on paper, with a wheel,
 * in Bluebeam — and types it here. Said out loud in the UI too, because a
 * field called "Length" on a construction screen invites the assumption that
 * something measured it for you.
 */
export function TakeoffForm({ jobId }: { jobId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [recipe, setRecipe] = useState("wall");
  const [label, setLabel] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [sides, setSides] = useState<"1" | "2">("2");
  const [spacingIn, setSpacingIn] = useState("16");
  const [wastePercent, setWastePercent] = useState("10");
  const [openings, setOpenings] = useState<{ w: string; h: string }[]>([]);
  const [areaSqFt, setAreaSqFt] = useState("");
  const [coats, setCoats] = useState("2");
  const [coverageSqFtPerGal, setCoverageSqFtPerGal] = useState("350");
  const [perimeterFt, setPerimeterFt] = useState("");
  const [fixtures, setFixtures] = useState<{ name: string; count: string }[]>([]);

  const preview = useMemo(() => {
    const n = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
    const opt = (value: string): number | undefined => {
      if (value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };

    if (recipe === "wall") {
      const parsedOpenings = openings
        .map((o) => ({ widthFt: n(o.w), heightFt: n(o.h) }))
        .filter((o) => o.widthFt > 0 && o.heightFt > 0);
      const spacing = opt(spacingIn);
      const args: RecipeArgs = {
        wastePercent: opt(wastePercent),
        spacingFt: spacing !== undefined ? spacing / 12 : undefined,
      };
      return recipeLines(
        "wall",
        [
          {
            kind: "wall",
            wall: {
              lengthFt: n(lengthFt),
              heightFt: n(heightFt),
              sides: sides === "1" ? 1 : 2,
              openings: parsedOpenings,
            },
          },
        ],
        args,
      );
    }
    if (recipe === "ceiling") {
      return recipeLines(
        "ceiling",
        [{ kind: "ceiling", ceiling: { lengthFt: n(lengthFt), widthFt: n(widthFt) } }],
        { wastePercent: opt(wastePercent) },
      );
    }
    if (recipe === "paint") {
      return recipeLines("paint", [{ kind: "area", squareFeet: n(areaSqFt) }], {
        coats: opt(coats),
        coverageSqFtPerGal: opt(coverageSqFtPerGal),
      });
    }
    if (recipe === "flooring") {
      const inputs: RecipeInput[] = [{ kind: "area", squareFeet: n(areaSqFt) }];
      const perimeter = n(perimeterFt);
      if (perimeter > 0) inputs.push({ kind: "linear", feet: perimeter });
      return recipeLines("flooring", inputs, { wastePercent: opt(wastePercent) });
    }
    const inputs: RecipeInput[] = fixtures
      .map((f) => ({ kind: "count" as const, item: f.name.trim(), count: Number(f.count) }))
      .filter((f) => f.item !== "" && Number.isFinite(f.count) && f.count > 0);
    return recipeLines("fixture-count", inputs, {});
  }, [
    recipe,
    label,
    lengthFt,
    heightFt,
    widthFt,
    sides,
    spacingIn,
    wastePercent,
    openings,
    areaSqFt,
    coats,
    coverageSqFtPerGal,
    perimeterFt,
    fixtures,
  ]);

  const hasQuantities = preview.some((line) => line.quantity > 0);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="mb-4 rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800"
      >
        Add from a takeoff
      </button>
    );
  }

  const field =
    "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
  const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await addTakeoffLines(jobId, formData);
            // The action RETURNS a refusal rather than throwing one, because
            // production redacts a thrown message to a digest. Rendering the
            // returned reason is the other half of that; ignoring it would
            // close the panel on a failure and look like it worked.
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setIsOpen(false);
            setLabel("");
            setLengthFt("");
            setHeightFt("");
            setWidthFt("");
            setAreaSqFt("");
            setPerimeterFt("");
            setOpenings([]);
            setFixtures([]);
          } catch (err) {
            // Still caught: the auth and stage guards above it throw, and
            // those are genuine bugs rather than anything a person typed.
            setError(err instanceof Error ? err.message : "Couldn't add those line items.");
          }
        });
      }}
      className="mb-4 flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink-label">Add from a takeoff</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Enter dimensions you have already measured — on paper, with a wheel, or in your takeoff
          software. This does the arithmetic; it does not measure drawings.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          What are you pricing
          <select
            name="recipe"
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
            className={field}
          >
            {RECIPES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Where (goes on every line)
          <input
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Level 2 corridor"
            className={field}
          />
        </label>

        {(recipe === "wall" || recipe === "ceiling") && (
          <label className={labelClass}>
            Length (ft)
            <input
              name="lengthFt"
              type="text"
              value={lengthFt}
              onChange={(e) => setLengthFt(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {recipe === "wall" && (
          <label className={labelClass}>
            Height (ft)
            <input
              name="heightFt"
              type="text"
              value={heightFt}
              onChange={(e) => setHeightFt(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {recipe === "ceiling" && (
          <label className={labelClass}>
            Width (ft)
            <input
              name="widthFt"
              type="text"
              value={widthFt}
              onChange={(e) => setWidthFt(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {recipe === "wall" && (
          <label className={labelClass}>
            Boarded sides
            <select
              name="sides"
              value={sides}
              onChange={(e) => setSides(e.target.value as "1" | "2")}
              className={field}
            >
              <option value="2">Both sides</option>
              <option value="1">One side</option>
            </select>
          </label>
        )}

        {recipe === "wall" && (
          <label className={labelClass}>
            Stud spacing (in o.c.)
            <input
              name="spacingIn"
              type="text"
              value={spacingIn}
              onChange={(e) => setSpacingIn(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {(recipe === "wall" || recipe === "ceiling" || recipe === "flooring") && (
          <label className={labelClass}>
            Waste (%)
            <input
              name="wastePercent"
              type="text"
              value={wastePercent}
              onChange={(e) => setWastePercent(e.target.value)}
              inputMode="decimal"
              className={field}
            />
            <span className="text-xs text-ink-muted">
              {recipe === "wall" ? "Applies to board only. Track carries none — the offcut is usable." : "Added to the order quantity."}
            </span>
          </label>
        )}

        {(recipe === "paint" || recipe === "flooring") && (
          <label className={labelClass}>
            Area (sq ft)
            <input
              name="areaSqFt"
              type="text"
              value={areaSqFt}
              onChange={(e) => setAreaSqFt(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {recipe === "paint" && (
          <label className={labelClass}>
            Coats
            <input
              name="coats"
              type="text"
              value={coats}
              onChange={(e) => setCoats(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {recipe === "paint" && (
          <label className={labelClass}>
            Coverage (sq ft/gal)
            <input
              name="coverageSqFtPerGal"
              type="text"
              value={coverageSqFtPerGal}
              onChange={(e) => setCoverageSqFtPerGal(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {recipe === "flooring" && (
          <label className={labelClass}>
            Trim / base perimeter (ft, optional)
            <input
              name="perimeterFt"
              type="text"
              value={perimeterFt}
              onChange={(e) => setPerimeterFt(e.target.value)}
              placeholder="leave blank if not trimming"
              inputMode="decimal"
              className={field}
            />
          </label>
        )}
      </div>

      {recipe === "wall" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-label">
            Openings{" "}
            <span className="text-xs text-ink-muted">
              — anything under 32 sq ft is not deducted, because it still costs labour to cut and
              finish around.
            </span>
          </p>
          {openings.map((opening, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                name="openingWidth"
                type="text"
                value={opening.w}
                onChange={(e) =>
                  setOpenings((prev) =>
                    prev.map((o, i) => (i === index ? { ...o, w: e.target.value } : o)),
                  )
                }
                placeholder="width ft"
                inputMode="decimal"
                className={`${field} w-28`}
              />
              <span className="text-ink-muted">×</span>
              <input
                name="openingHeight"
                type="text"
                value={opening.h}
                onChange={(e) =>
                  setOpenings((prev) =>
                    prev.map((o, i) => (i === index ? { ...o, h: e.target.value } : o)),
                  )
                }
                placeholder="height ft"
                inputMode="decimal"
                className={`${field} w-28`}
              />
              <button
                type="button"
                onClick={() => setOpenings((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs text-red-400 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOpenings((prev) => [...prev, { w: "", h: "" }])}
            className="self-start text-xs text-link hover:underline"
          >
            + Add an opening
          </button>
        </div>
      )}

      {recipe === "fixture-count" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-label">
            Fixtures{" "}
            <span className="text-xs text-ink-muted">
              — count each type; one line is added per type.
            </span>
          </p>
          {fixtures.map((fixture, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                name="fixtureName"
                value={fixture.name}
                onChange={(e) =>
                  setFixtures((prev) =>
                    prev.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)),
                  )
                }
                placeholder="e.g. Outlets"
                className={`${field} flex-1`}
              />
              <input
                name="fixtureCount"
                type="text"
                value={fixture.count}
                onChange={(e) =>
                  setFixtures((prev) =>
                    prev.map((f, i) => (i === index ? { ...f, count: e.target.value } : f)),
                  )
                }
                placeholder="count"
                inputMode="numeric"
                className={`${field} w-24`}
              />
              <button
                type="button"
                onClick={() => setFixtures((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs text-red-400 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFixtures((prev) => [...prev, { name: "", count: "" }])}
            className="self-start text-xs text-link hover:underline"
          >
            + Add a fixture type
          </button>
        </div>
      )}

      {/* Shown before anything is saved. An estimator will not trust a
          quantity that appeared in a bid without having seen it, and a
          takeoff whose arithmetic nobody checks is one nobody should use. */}
      <div className="rounded-md border border-line-row bg-canvas p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          What will be added
        </p>
        {hasQuantities ? (
          <ul className="mt-2 flex flex-col gap-1">
            {preview
              .filter((line) => line.quantity > 0)
              .map((line) => (
                <li key={line.label} className="flex justify-between text-sm">
                  <span className="text-ink-label">
                    {label ? `${label} — ${line.label}` : line.label}
                  </span>
                  <span className="tabular-nums text-ink">
                    {line.quantity} {line.unit}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Enter dimensions above and the quantities appear here.
          </p>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Added without a price. A takeoff gives quantities, not rates — price them below or pull
          one across from the catalog.
        </p>
      </div>

      {error && <p className="text-sm text-tag-amber-ink">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !hasQuantities}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add these line items"}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
