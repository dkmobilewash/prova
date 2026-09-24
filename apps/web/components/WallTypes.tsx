"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  addStarterWallTypes,
  addWallTypeComponent,
  createWallType,
  deleteWallType,
  removeWallTypeComponent,
  updateWallType,
  updateWallTypeComponent,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { WALL_BASIS_LABELS, WALL_COMPONENT_BASES, type WallComponentBasis } from "@/lib/wall-assemblies";

/**
 * The partition schedule on /wall-types: a card per wall type, its parts
 * listed under it.
 *
 * Every form is the house pattern (`LogTimeEntryForm.tsx` is the reference):
 * `onSubmit` + `preventDefault()` + `new FormData(currentTarget)`, the
 * returned `{ ok: false, error }` rendered beside it, reset only on success
 * and never on an edit-in-place row.
 */

type Result = { ok: true } | { ok: false; error: string };

export type PickOption = { id: string; label: string };

export type WallTypeView = {
  id: string;
  code: string;
  name: string;
  sides: number;
  studSpacingIn: string;
  defaultHeightFt: string | null;
  notes: string | null;
  runCount: number;
  components: WallComponentView[];
};

export type WallComponentView = {
  id: string;
  description: string;
  unit: string | null;
  basis: WallComponentBasis;
  factor: string;
  wastePercent: string;
  roundUp: boolean;
  productionRate: string | null;
  catalogEntryId: string | null;
  craftClassificationId: string | null;
};

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const small = "rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-ink hover:bg-neutral-700 disabled:opacity-50";
const labelClass = "flex flex-col gap-1 text-xs text-ink-label";

function useSubmit(run: (formData: FormData) => Promise<Result>, resetOnSuccess = true) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await run(formData);
      if (!result.ok) return setError(result.error);
      if (resetOnSuccess) form.reset();
    });
  }
  return { isPending, error, onSubmit };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="w-full text-sm text-tag-amber-ink">{error}</p> : null;
}

/* --------------------------------------------------------------- type */

function WallTypeFields({ type }: { type?: WallTypeView }) {
  return (
    <>
      <label className={labelClass}>
        Tag
        <input name="code" defaultValue={type?.code} placeholder="W1" className={`${field} w-20`} />
      </label>
      <label className={`${labelClass} min-w-[220px] flex-1`}>
        What it is
        <input name="name" defaultValue={type?.name} placeholder="3⅝″ 20ga studs at 16″, ⅝″ Type X each side" className={field} />
      </label>
      <label className={labelClass}>
        Boarded sides
        <select name="sides" defaultValue={String(type?.sides ?? 2)} className={field}>
          <option value="2">Both</option>
          <option value="1">One</option>
        </select>
      </label>
      <label className={labelClass}>
        Stud spacing (in)
        <input name="studSpacingIn" defaultValue={type?.studSpacingIn ?? "16"} inputMode="decimal" className={`${field} w-20`} />
      </label>
      <label className={labelClass}>
        Default height (ft)
        <input name="defaultHeightFt" defaultValue={type?.defaultHeightFt ?? ""} placeholder="each run's own" inputMode="decimal" className={`${field} w-28`} />
      </label>
    </>
  );
}

export function NewWallTypeForm() {
  const { isPending, error, onSubmit } = useSubmit((fd) => createWallType(fd));
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-line-card bg-surface p-4">
      <WallTypeFields />
      <button type="submit" disabled={isPending} className={small}>
        {isPending ? "Adding…" : "Add wall type"}
      </button>
      <ErrorLine error={error} />
    </form>
  );
}

export function StarterWallTypesButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await addStarterWallTypes();
            setMessage(result.ok ? `Added ${result.value.added.join(" and ")}. Link each part to your price book.` : result.error);
          })
        }
        className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Start from two common wall types"}
      </button>
      {message && <p className="text-sm text-ink-body">{message}</p>}
    </div>
  );
}

export function WallTypeCard({
  type,
  catalog,
  crafts,
}: {
  type: WallTypeView;
  catalog: PickOption[];
  crafts: PickOption[];
}) {
  const save = useSubmit((fd) => updateWallType(type.id, fd), false);
  const [isRemoving, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <li className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <form onSubmit={save.onSubmit} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <WallTypeFields type={type} />
          <button type="submit" disabled={save.isPending} className={small}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <ErrorLine error={save.error} />
        </form>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <RowActions
            className="flex items-center justify-end gap-2"
            destructive={
              <ConfirmDelete
                pinned="end"
                describe={
                  type.runCount > 0
                    ? `Used on ${type.runCount} wall run${type.runCount === 1 ? "" : "s"} — those runs have to go first.`
                    : "Takes this wall type out of your schedule. No estimate uses it."
                }
                label="Remove"
                confirmLabel="Remove it"
                pendingLabel="Removing…"
                pending={isRemoving}
                onConfirm={() => {
                  setRemoveError(null);
                  startRemove(async () => {
                    const result = await deleteWallType(type.id);
                    if (!result.ok) setRemoveError(result.error);
                  });
                }}
              />
            }
          />
          {removeError && <p className="max-w-[18rem] text-right text-xs text-tag-amber-ink">{removeError}</p>}
        </div>
      </div>

      {type.notes && <p className="mt-2 text-xs text-ink-muted">{type.notes}</p>}

      <ul className="mt-3 flex flex-col gap-2 border-t border-line-row pt-3">
        {type.components.map((component) => (
          <WallComponentRow key={component.id} component={component} catalog={catalog} crafts={crafts} />
        ))}
        {type.components.length === 0 && <li className="text-sm text-ink-body">No parts yet — add the studs, track and board below.</li>}
      </ul>
      <NewWallComponentForm wallTypeId={type.id} catalog={catalog} crafts={crafts} />
    </li>
  );
}

/* ---------------------------------------------------------- component */

function ComponentFields({
  component,
  catalog,
  crafts,
}: {
  component?: WallComponentView;
  catalog: PickOption[];
  crafts: PickOption[];
}) {
  return (
    <>
      <label className={`${labelClass} min-w-[180px] flex-1`}>
        Part
        <input name="description" defaultValue={component?.description} placeholder="⅝″ Type X, 4x8 sheets" className={field} />
      </label>
      <label className={labelClass}>
        Unit
        <input name="unit" defaultValue={component?.unit ?? ""} placeholder="sheets" className={`${field} w-20`} />
      </label>
      <label className={labelClass}>
        Counted
        <select name="basis" defaultValue={component?.basis ?? "BOARDED_SQFT"} className={field}>
          {WALL_COMPONENT_BASES.map((basis) => (
            <option key={basis} value={basis}>
              {WALL_BASIS_LABELS[basis]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        × factor
        <input name="factor" defaultValue={component?.factor ?? "1"} inputMode="decimal" title="2 for top-and-bottom track, the layer count for board, 0.03125 to turn sq ft into 4x8 sheets" className={`${field} w-20`} />
      </label>
      <label className={labelClass}>
        Waste %
        <input name="wastePercent" defaultValue={component?.wastePercent ?? "0"} inputMode="decimal" className={`${field} w-16`} />
      </label>
      <label className="flex items-center gap-1 self-end pb-2 text-xs text-ink-label">
        <input type="checkbox" name="roundUp" defaultChecked={component?.roundUp ?? false} />
        Whole units
      </label>
      <label className={labelClass}>
        Crew rate (units/hr)
        <input name="productionRate" defaultValue={component?.productionRate ?? ""} placeholder="none" inputMode="decimal" className={`${field} w-24`} />
      </label>
      <label className={labelClass}>
        Price from
        <select name="catalogEntryId" defaultValue={component?.catalogEntryId ?? ""} className={`${field} max-w-[14rem]`}>
          <option value="">Unpriced</option>
          {catalog.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      {crafts.length > 0 && (
        <label className={labelClass}>
          Craft
          <select name="craftClassificationId" defaultValue={component?.craftClassificationId ?? ""} className={`${field} max-w-[12rem]`}>
            <option value="">From the price book</option>
            {crafts.map((craft) => (
              <option key={craft.id} value={craft.id}>
                {craft.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function WallComponentRow({
  component,
  catalog,
  crafts,
}: {
  component: WallComponentView;
  catalog: PickOption[];
  crafts: PickOption[];
}) {
  const save = useSubmit((fd) => updateWallTypeComponent(component.id, fd), false);
  const [isRemoving, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <form onSubmit={save.onSubmit} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
        <ComponentFields component={component} catalog={catalog} crafts={crafts} />
        <button type="submit" disabled={save.isPending} className={small}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <ErrorLine error={save.error} />
      </form>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <RowActions
          className="flex items-center justify-end gap-2"
          destructive={
            <ConfirmDelete
              pinned="end"
              describe="Takes this part out of the wall type. Estimate lines already made from it stay, as ordinary lines."
              label="Remove"
              confirmLabel="Remove it"
              pendingLabel="Removing…"
              pending={isRemoving}
              onConfirm={() => {
                setRemoveError(null);
                startRemove(async () => {
                  const result = await removeWallTypeComponent(component.id);
                  if (!result.ok) setRemoveError(result.error);
                });
              }}
              deleteClassName="text-xs text-red-400 hover:underline"
            />
          }
        />
        {removeError && <p className="max-w-[16rem] text-right text-xs text-tag-amber-ink">{removeError}</p>}
      </div>
    </li>
  );
}

function NewWallComponentForm({
  wallTypeId,
  catalog,
  crafts,
}: {
  wallTypeId: string;
  catalog: PickOption[];
  crafts: PickOption[];
}) {
  const { isPending, error, onSubmit } = useSubmit((fd) => addWallTypeComponent(wallTypeId, fd));
  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-line-card p-3">
      <ComponentFields catalog={catalog} crafts={crafts} />
      <button type="submit" disabled={isPending} className={small}>
        {isPending ? "Adding…" : "Add part"}
      </button>
      <ErrorLine error={error} />
    </form>
  );
}
