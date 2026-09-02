"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createFringeRateSchedule,
  deleteFringeRateSchedule,
  endFringeRateSchedule,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import type { FringeScheduleRow } from "@/lib/union-compliance-query";
import { inputClass, labelClass } from "@/components/RfiFields";
import { localToday } from "@/components/localToday";
import { money } from "@/lib/money";

const btn =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

/** The effective-dated wage and fringe rates for one classification.
 *
 * Ending a rate is offered before adding one, because that is the order
 * the database requires: overlapping ranges are refused by an exclusion
 * constraint, so a new rate cannot start until the current one closes. */
export function FringeScheduleList({
  craftId,
  craftName,
  schedules,
  today,
  canDelete,
}: {
  craftId: string;
  craftName: string;
  schedules: FringeScheduleRow[];
  today: string;
  canDelete: boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
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

  const fringeTotal = (s: FringeScheduleRow) =>
    (s.pensionRate ?? 0) + (s.vacationRate ?? 0) + (s.healthWelfareRate ?? 0) + (s.trainingRate ?? 0);

  return (
    <div className="mt-2 border-l-2 border-slate-800 pl-3">
      {schedules.length === 0 ? (
        <p className="text-xs text-amber-300">
          No rate recorded — hours on this classification can&apos;t be priced, and the remittance
          reports them as unpriced rather than as $0.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {schedules.map((schedule) => {
            const current =
              schedule.effectiveFrom <= today &&
              (schedule.effectiveTo === null || schedule.effectiveTo >= today);
            return (
              <li key={schedule.id} className="text-xs text-slate-400">
                <span className="font-mono text-slate-300">{money(schedule.baseWage)}</span> base +{" "}
                <span className="font-mono text-slate-300">{money(fringeTotal(schedule))}</span> fringe
                <span className="text-slate-500">
                  {" "}
                  · from {schedule.effectiveFrom}
                  {schedule.effectiveTo ? ` to ${schedule.effectiveTo}` : ""}
                </span>
                {current && (
                  <span className="ml-2 rounded bg-green-500/15 px-1.5 py-0.5 text-green-300">in force</span>
                )}

                {endingId === schedule.id ? (
                  <form
                    onSubmit={(e) =>
                      submit(e, (fd) => endFringeRateSchedule(schedule.id, fd), () => setEndingId(null))
                    }
                    className="mt-1 flex flex-wrap items-end gap-2"
                  >
                    <label className={labelClass}>
                      <span className="text-xs">In force until</span>
                      <input
                        type="date"
                        name="effectiveTo"
                        required
                        defaultValue={localToday()}
                        className={`${inputClass} py-1 text-xs`}
                      />
                    </label>
                    <button type="submit" disabled={isPending} className={btn}>
                      Save
                    </button>
                    <button type="button" disabled={isPending} onClick={() => setEndingId(null)} className={btn}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <span className="ml-2 inline-flex gap-2">
                    {schedule.effectiveTo === null && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setEndingId(schedule.id);
                          setError(null);
                        }}
                        className="text-blue-400 underline"
                      >
                        end it
                      </button>
                    )}
                    {canDelete &&
                      (confirming === schedule.id ? (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              run(() => deleteFringeRateSchedule(schedule.id), () => setConfirming(null))
                            }
                            className="text-red-400 underline"
                          >
                            confirm delete
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirming(null)}
                            className="text-slate-400 underline"
                          >
                            cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            setConfirming(schedule.id);
                            setError(null);
                          }}
                          className="text-slate-500 underline"
                        >
                          delete
                        </button>
                      ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

      {isAdding ? (
        <form
          onSubmit={(e) => submit(e, createFringeRateSchedule, () => setIsAdding(false))}
          className="mt-2 flex flex-col gap-2 rounded-md border border-slate-700 p-2"
        >
          <input type="hidden" name="craftClassificationId" value={craftId} />
          <p className="text-xs text-slate-400">Rate for {craftName}</p>
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              ["baseWage", "Base wage", true],
              ["pensionRate", "Pension", false],
              ["vacationRate", "Vacation", false],
              ["healthWelfareRate", "H&W", false],
              ["trainingRate", "Training", false],
            ].map(([name, label, required]) => (
              <label key={name as string} className={labelClass}>
                <span className="text-xs">{label as string}</span>
                <input
                  type="number"
                  name={name as string}
                  step="0.01"
                  min="0"
                  required={required as boolean}
                  placeholder="per hour"
                  className={`${inputClass} py-1 text-xs`}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Blank on a fund means nothing is contributed to it — different from zero being unknown.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className="text-xs">In force from</span>
              <input type="date" name="effectiveFrom" required className={`${inputClass} py-1 text-xs`} />
              <span className="text-xs text-slate-500">
                Not pre-filled — a rate usually took effect on a date the CBA names, not today.
              </span>
            </label>
            <label className={labelClass}>
              <span className="text-xs">In force until</span>
              <input type="date" name="effectiveTo" className={`${inputClass} py-1 text-xs`} />
            </label>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={btn}>
              {isPending ? "Saving…" : "Save rate"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setIsAdding(false)} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsAdding(true);
            setError(null);
          }}
          className="mt-1 text-xs text-blue-400 underline disabled:opacity-50"
        >
          Add a rate
        </button>
      )}
    </div>
  );
}
