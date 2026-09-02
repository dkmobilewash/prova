"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addTakeoffLineItems } from "@/lib/actions";
import {
  DEFAULT_STUD_SPACING_FT,
  takeoffCeiling,
  takeoffWall,
  type Opening,
} from "@/lib/takeoff";

/**
 * Measured dimensions in, priced-later line items out.
 *
 * THE PREVIEW IS THE POINT. An estimator will not trust quantities that
 * appear in a bid without having seen them first, and they are right not to
 * — a takeoff tool that computes silently is one whose arithmetic nobody
 * ever checks. So the same pure functions run here as you type, and the
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

  const [surface, setSurface] = useState<"wall" | "ceiling">("wall");
  const [label, setLabel] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [sides, setSides] = useState<"1" | "2">("2");
  const [wastePercent, setWastePercent] = useState("10");
  const [spacingIn, setSpacingIn] = useState("16");
  const [openings, setOpenings] = useState<{ w: string; h: string }[]>([]);

  const preview = useMemo(() => {
    const n = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
    const options = {
      wastePercent: Number.isFinite(Number(wastePercent)) ? Number(wastePercent) : undefined,
      spacingFt: n(spacingIn) > 0 ? n(spacingIn) / 12 : DEFAULT_STUD_SPACING_FT,
    };
    if (surface === "ceiling") {
      return takeoffCeiling({ lengthFt: n(lengthFt), widthFt: n(widthFt) }, options);
    }
    const parsedOpenings: Opening[] = openings
      .map((o) => ({ widthFt: n(o.w), heightFt: n(o.h) }))
      .filter((o) => o.widthFt > 0 && o.heightFt > 0);
    return takeoffWall(
      {
        lengthFt: n(lengthFt),
        heightFt: n(heightFt),
        sides: sides === "1" ? 1 : 2,
        openings: parsedOpenings,
      },
      options,
    );
  }, [surface, lengthFt, heightFt, widthFt, sides, wastePercent, spacingIn, openings]);

  const hasQuantities = preview.some((line) => line.quantity > 0);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="mb-4 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
      >
        Add from a takeoff
      </button>
    );
  }

  const field =
    "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
  const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await addTakeoffLineItems(jobId, formData);
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
            setOpenings([]);
          } catch (err) {
            // Still caught: the auth and stage guards above it throw, and
            // those are genuine bugs rather than anything a person typed.
            setError(err instanceof Error ? err.message : "Couldn't add those line items.");
          }
        });
      }}
      className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-slate-300">Add from a takeoff</h3>
        <p className="mt-1 text-xs text-slate-500">
          Enter dimensions you have already measured — on paper, with a wheel, or in your takeoff
          software. This does the arithmetic; it does not measure drawings.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Surface
          <select
            name="surface"
            value={surface}
            onChange={(e) => setSurface(e.target.value as "wall" | "ceiling")}
            className={field}
          >
            <option value="wall">Wall</option>
            <option value="ceiling">Ceiling</option>
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

        <label className={labelClass}>
          Length (ft)
          <input
            name="lengthFt"
            value={lengthFt}
            onChange={(e) => setLengthFt(e.target.value)}
            inputMode="decimal"
            className={field}
          />
        </label>

        {surface === "wall" ? (
          <label className={labelClass}>
            Height (ft)
            <input
              name="heightFt"
              value={heightFt}
              onChange={(e) => setHeightFt(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        ) : (
          <label className={labelClass}>
            Width (ft)
            <input
              name="widthFt"
              value={widthFt}
              onChange={(e) => setWidthFt(e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </label>
        )}

        {surface === "wall" && (
          <>
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
            <label className={labelClass}>
              Stud spacing (in o.c.)
              <input
                name="spacingIn"
                value={spacingIn}
                onChange={(e) => setSpacingIn(e.target.value)}
                inputMode="decimal"
                className={field}
              />
            </label>
          </>
        )}

        <label className={labelClass}>
          Waste (%)
          <input
            name="wastePercent"
            value={wastePercent}
            onChange={(e) => setWastePercent(e.target.value)}
            inputMode="decimal"
            className={field}
          />
          <span className="text-xs text-slate-500">
            Applies to board only. Track carries none — the offcut is usable.
          </span>
        </label>
      </div>

      {surface === "wall" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-300">
            Openings{" "}
            <span className="text-xs text-slate-500">
              — anything under 32 sq ft is not deducted, because it still costs labour to cut and
              finish around.
            </span>
          </p>
          {openings.map((opening, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                name="openingWidth"
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
              <span className="text-slate-500">×</span>
              <input
                name="openingHeight"
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
            className="self-start text-xs text-blue-400 hover:underline"
          >
            + Add an opening
          </button>
        </div>
      )}

      {/* Shown before anything is saved. An estimator will not trust a
          quantity that appeared in a bid without having seen it, and a
          takeoff whose arithmetic nobody checks is one nobody should use. */}
      <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          What will be added
        </p>
        {hasQuantities ? (
          <ul className="mt-2 flex flex-col gap-1">
            {preview
              .filter((line) => line.quantity > 0)
              .map((line) => (
                <li key={line.label} className="flex justify-between text-sm">
                  <span className="text-slate-300">
                    {label ? `${label} — ${line.label}` : line.label}
                  </span>
                  <span className="tabular-nums text-slate-100">
                    {line.quantity} {line.unit}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Enter dimensions above and the quantities appear here.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Added without a price. A takeoff gives quantities, not rates — price them below or pull
          one across from the catalog.
        </p>
      </div>

      {error && <p className="text-sm text-amber-300">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !hasQuantities}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add these line items"}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
