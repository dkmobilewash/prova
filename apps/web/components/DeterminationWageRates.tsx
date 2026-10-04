"use client";

import { Spinner } from "@/components/Spinner";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDeterminationWageRate,
  deleteDeterminationWageRate,
} from "@/lib/actions";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { money } from "@/lib/money";

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const lab = "flex flex-col gap-1 text-xs text-ink-body";

export type WageRateRow = {
  id: string;
  classification: string;
  craftLabel: string | null;
  baseWage: string;
  pensionRate: string | null;
  vacationRate: string | null;
  healthWelfareRate: string | null;
  trainingRate: string | null;
};

/**
 * THE RATES A DETERMINATION PUBLISHES, under the determination they came
 * from.
 *
 * `PrevailingWageDetermination` carried no rates until 2026-10-02 and said
 * so in the schema — "there is no rate column and none is planned". That
 * was reversed deliberately, because it was what kept rates tied to
 * `CraftClassification` -> `UnionLocal`, and a union local is not a
 * jurisdiction: the same craft could not hold a different rate in Nevada
 * than in California.
 *
 * The form is collapsed behind a button and the delete is two-step, like
 * every other list in this app. Both actions return `ActionResult` and
 * their sentence is rendered, because production redacts a thrown one to a
 * digest — and "a base wage of 0 is not a rate" is useless as a digest.
 *
 * THE CRAFT PICKER IS OPTIONAL ON PURPOSE. A determination names its own
 * classifications and they do not match ours. Requiring the mapping here
 * would make somebody guess while they are copying a government document.
 */
export function DeterminationWageRates({
  jobId,
  determinationId,
  rates,
  crafts,
}: {
  jobId: string;
  determinationId: string;
  rates: WageRateRow[];
  crafts: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // onSubmit rather than <form action={…}>: in React 19 a client form
  // action RESETS the form before the action runs, so a returned refusal —
  // "a base wage of 0 is not a rate" — would arrive over emptied fields and
  // the person would have to retype the figures they just copied off a PDF.
  // formActionCensus.test.ts fails the build on the other shape.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const form = event.currentTarget;
    setError(null);
    start(async () => {
      const result = await addDeterminationWageRate(
        jobId,
        determinationId,
        formData,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Reset only on success, for the same reason.
      form.reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-3">
      {rates.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No rates recorded off this determination yet. Without them the hours
          on this job are priced from the craft&apos;s own fringe schedule,
          which is not jurisdiction-specific.
        </p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">Classification</th>
              <th className="py-1 pr-2 font-medium">Base</th>
              <th className="py-1 pr-2 font-medium">Pension</th>
              <th className="py-1 pr-2 font-medium">Vac.</th>
              <th className="py-1 pr-2 font-medium">H&amp;W</th>
              <th className="py-1 pr-2 font-medium">Training</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <tr key={rate.id} className="border-t border-line-row align-top">
                <td className="py-1 pr-2 text-ink">
                  {rate.classification}
                  {rate.craftLabel ? (
                    <span className="block text-ink-muted">
                      = {rate.craftLabel}
                    </span>
                  ) : (
                    // Not an error: the document's names are not ours, and
                    // an unmapped rate is still what the document published.
                    <span className="block text-ink-muted">
                      not mapped to a craft
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2 text-ink">
                  {money(Number(rate.baseWage))}
                </td>
                {(
                  [
                    "pensionRate",
                    "vacationRate",
                    "healthWelfareRate",
                    "trainingRate",
                  ] as const
                ).map((key) => (
                  <td key={key} className="py-1 pr-2 text-ink-body">
                    {/* Blank is "the document does not say"; a printed 0
                          is "the document says none". They are different. */}
                    {rate[key] == null ? "—" : money(Number(rate[key]))}
                  </td>
                ))}
                <td className="py-1">
                  <ConfirmDeleteButton
                    label="Remove"
                    describe={`Removes the ${rate.classification} rate read off this determination. The determination itself stays.`}
                    action={async () => {
                      const result = await deleteDeterminationWageRate(
                        jobId,
                        rate.id,
                      );
                      if (!result.ok) setError(result.error);
                      else router.refresh();
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error ? <p className="mt-2 text-xs text-rose-ink">{error}</p> : null}

      {open ? (
        <form onSubmit={onSubmit} className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className={`${lab} sm:col-span-3`}>
            Classification, as the determination names it
            <input
              name="classification"
              className={field}
              placeholder="Drywall Finisher/Taper"
              required
            />
          </label>
          <label className={lab}>
            Base wage
            <input
              name="baseWage"
              className={field}
              placeholder="52.34"
              inputMode="decimal"
              required
            />
          </label>
          <label className={lab}>
            Pension
            <input
              name="pensionRate"
              className={field}
              placeholder="optional"
              inputMode="decimal"
            />
          </label>
          <label className={lab}>
            Vacation
            <input
              name="vacationRate"
              className={field}
              placeholder="optional"
              inputMode="decimal"
            />
          </label>
          <label className={lab}>
            Health &amp; welfare
            <input
              name="healthWelfareRate"
              className={field}
              placeholder="optional"
              inputMode="decimal"
            />
          </label>
          <label className={lab}>
            Training
            <input
              name="trainingRate"
              className={field}
              placeholder="optional"
              inputMode="decimal"
            />
          </label>
          <label className={lab}>
            Our classification (optional)
            <select
              name="craftClassificationId"
              className={field}
              defaultValue=""
            >
              <option value="">Not mapped</option>
              {crafts.map((craft) => (
                <option key={craft.id} value={craft.id}>
                  {craft.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={pending}
              // text-neutral-900, not white: brand is the founder yellow and white on
              // it measures 1.53:1. theme-contrast.test.ts fails the build on it.
              className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-60"
            >
              {pending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  Saving…
                </span>
              ) : (
                "Save rate"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="text-xs text-ink-body hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-medium text-link hover:underline"
        >
          Add a rate from this determination →
        </button>
      )}
    </div>
  );
}
