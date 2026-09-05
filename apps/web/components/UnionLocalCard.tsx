"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCraftClassification,
  deleteCraftClassification,
  endUnionAgreement,
  setApprenticeRatioRule,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import type { SetupLocalRow } from "@/lib/union-compliance-query";
import { inputClass, labelClass } from "@/components/RfiFields";
import { CraftTierPicker } from "@/components/CraftTierPicker";
import { FringeScheduleList } from "@/components/FringeScheduleList";
import { localToday } from "@/components/localToday";
import { ratioLabel } from "@/lib/apprentice-ratio";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

/** One local: the agreement, its apprentice ratio, and its classifications
 * with their rates. Everything the two reports above read from. */
export function UnionLocalCard({
  local,
  today,
  canDelete,
}: {
  local: SetupLocalRow;
  today: string;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState<"none" | "craft" | "ratio" | "end">("none");
  const [tier, setTier] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
      // On top of the action's own revalidatePath. Browser testing found
      // two of these forms leaving the page stale until a manual reload
      // while the others updated live; every action revalidates and every
      // form calls them the same way, so this is NOT a root-cause fix, it
      // is the one that holds whatever the cause. A save that looks like
      // it did nothing gets clicked again, and no create here is
      // idempotent.
        router.refresh();
        onOk?.();
      } else {
        setError(result.error);
      }
    });
  }

  function submit(
    event: React.FormEvent<HTMLFormElement>,
    action: (fd: FormData) => Promise<ActionResult>,
    onOk?: () => void,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => action(formData), onOk);
  }

  const current = local.effectiveTo === null || local.effectiveTo >= today;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-slate-100">{local.label}</p>
          <p className="text-xs text-slate-500">
            {local.tradeJurisdiction && `${local.tradeJurisdiction} · `}
            agreement from {local.effectiveFrom}
            {local.effectiveTo ? ` to ${local.effectiveTo}` : ""}
          </p>
        </div>
        {current ? (
          <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-300">Current</span>
        ) : (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-500">Ended</span>
        )}
      </div>

      {/* ---------------------------------------------------- ratio --- */}
      <div className="text-sm">
        <span className="text-slate-400">Apprentice ratio: </span>
        {local.ratio ? (
          <>
            <span className="text-slate-200">{ratioLabel(local.ratio)}</span>
            {local.ratio.programStandardReference && (
              <span className="text-slate-500"> · {local.ratio.programStandardReference}</span>
            )}
          </>
        ) : (
          <span className="text-amber-300">
            none recorded — days with apprentice hours read &ldquo;can&apos;t be judged&rdquo;
          </span>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(open === "ratio" ? "none" : "ratio");
            setError(null);
          }}
          className="ml-2 text-xs text-blue-400 underline disabled:opacity-50"
        >
          {local.ratio ? "change" : "set it"}
        </button>
      </div>

      {open === "ratio" && (
        <form
          onSubmit={(e) => submit(e, setApprenticeRatioRule, () => setOpen("none"))}
          className="flex flex-wrap items-end gap-2 rounded-md border border-slate-700 p-3"
        >
          <input type="hidden" name="unionLocalId" value={local.unionLocalId} />
          <label className={labelClass}>
            <span className="text-xs">Apprentices</span>
            <input
              type="number"
              name="apprenticeCount"
              min="1"
              max="99"
              required
              defaultValue={local.ratio?.apprenticeCount ?? 1}
              className={`${inputClass} w-24 py-1 text-sm`}
            />
          </label>
          <span className="pb-2 text-sm text-slate-500">per</span>
          <label className={labelClass}>
            <span className="text-xs">Journeymen</span>
            <input
              type="number"
              name="journeymenCount"
              min="1"
              max="99"
              required
              defaultValue={local.ratio?.journeymenCount ?? 3}
              className={`${inputClass} w-24 py-1 text-sm`}
            />
          </label>
          <label className={`${labelClass} min-w-[14rem] flex-1`}>
            <span className="text-xs">Programme standard</span>
            <input
              type="text"
              name="programStandardReference"
              defaultValue={local.ratio?.programStandardReference ?? ""}
              placeholder="Optional — where the ratio is written, and whether it counts hours or heads"
              className={`${inputClass} py-1 text-sm`}
            />
          </label>
          <button type="submit" disabled={isPending} className={btn}>
            {isPending ? "Saving…" : "Save ratio"}
          </button>
          <button type="button" disabled={isPending} onClick={() => setOpen("none")} className={btn}>
            Cancel
          </button>
        </form>
      )}

      {/* ----------------------------------------------- classifications */}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Classifications
        </p>
        {local.crafts.length === 0 ? (
          <p className="text-sm text-slate-400">
            None yet. Hours can only be tagged to a classification that exists here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {local.crafts.map((craft) => (
              <li key={craft.id} className="rounded-md border border-slate-800 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100">{craft.name}</p>
                    <p className="text-xs text-slate-500">
                      {craft.usageCount > 0
                        ? `${craft.usageCount} record${craft.usageCount === 1 ? "" : "s"} tagged`
                        : "nothing tagged yet"}
                    </p>
                  </div>
                  {/* The tier picker is a live write — a <select> that saves on
                      change and an apprentice-period box that saves on blur —
                      and it used to stay live beside an armed "confirm delete",
                      so a click meant for cancel could re-classify the record
                      you were about to destroy. It is a child of RowActions
                      now, so arming empties this cluster of everything but the
                      cancel/confirm pair. Per-row state too: each craft owns
                      its own armed flag, so the keyed `confirming === craft.id`
                      is gone. */}
                  <RowActions
                    className="flex flex-col items-end gap-1"
                    destructive={
                      canDelete ? (
                        <ConfirmDelete
                          label="delete"
                          confirmLabel="confirm delete"
                          cancelLabel="cancel"
                          // This cluster is a COLUMN (the tier picker sits
                          // above), so the armed pair needs its own row or
                          // it stacks.
                          armedClassName="flex gap-2"
                          pending={isPending}
                          onConfirm={() => run(() => deleteCraftClassification(craft.id))}
                          deleteClassName="text-xs text-slate-500 underline disabled:opacity-50"
                          cancelClassName="text-xs text-slate-400 underline disabled:opacity-50"
                          confirmClassName="text-xs text-red-400 underline disabled:opacity-50"
                        />
                      ) : null
                    }
                  >
                    <CraftTierPicker
                      craftId={craft.id}
                      tier={craft.tier}
                      apprenticePeriod={craft.apprenticePeriod}
                    />
                  </RowActions>
                </div>

                <FringeScheduleList
                  craftId={craft.id}
                  craftName={craft.name}
                  schedules={craft.schedules}
                  today={today}
                  canDelete={canDelete}
                />
              </li>
            ))}
          </ul>
        )}

        {open === "craft" ? (
          <form
            onSubmit={(e) =>
              submit(e, createCraftClassification, () => {
                setOpen("none");
                setTier("");
              })
            }
            className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-700 p-3"
          >
            <input type="hidden" name="unionLocalId" value={local.unionLocalId} />
            <label className={`${labelClass} min-w-[14rem] flex-1`}>
              <span className="text-xs">Classification name</span>
              <input
                type="text"
                name="name"
                required
                placeholder="As the CBA words it"
                className={`${inputClass} py-1 text-sm`}
              />
            </label>
            <label className={labelClass}>
              <span className="text-xs">Tier</span>
              <select
                name="tier"
                value={tier}
                onChange={(event) => setTier(event.target.value)}
                className={`${inputClass} py-1 text-sm`}
              >
                <option value="">Not classified</option>
                <option value="JOURNEYMAN">Journeyman</option>
                <option value="APPRENTICE">Apprentice</option>
                <option value="FOREMAN">Foreman</option>
              </select>
            </label>
            {tier === "APPRENTICE" && (
              <label className={labelClass}>
                <span className="text-xs">Period</span>
                <input
                  type="number"
                  name="apprenticePeriod"
                  min="1"
                  max="10"
                  className={`${inputClass} w-20 py-1 text-sm`}
                />
              </label>
            )}
            <button type="submit" disabled={isPending} className={btn}>
              {isPending ? "Saving…" : "Add"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setOpen("none")} className={btn}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setOpen("craft");
              setError(null);
            }}
            className="mt-2 text-xs text-blue-400 underline disabled:opacity-50"
          >
            Add a classification
          </button>
        )}
      </div>

      {/* ------------------------------------------------- end agreement */}
      {local.effectiveTo === null && (
        <div>
          {open === "end" ? (
            <form
              onSubmit={(e) =>
                submit(e, (fd) => endUnionAgreement(local.agreementId, fd), () => setOpen("none"))
              }
              className="flex flex-wrap items-end gap-2"
            >
              <label className={labelClass}>
                <span className="text-xs">Agreement in force until</span>
                <input
                  type="date"
                  name="effectiveTo"
                  required
                  defaultValue={localToday()}
                  className={`${inputClass} py-1 text-sm`}
                />
              </label>
              <button type="submit" disabled={isPending} className={btn}>
                Save
              </button>
              <button type="button" disabled={isPending} onClick={() => setOpen("none")} className={btn}>
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setOpen("end");
                setError(null);
              }}
              className="text-xs text-slate-500 underline disabled:opacity-50"
            >
              End this agreement
            </button>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Ended, never deleted — payroll already filed under this CBA has to stay explainable.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </li>
  );
}
