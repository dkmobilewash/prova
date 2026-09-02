"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createUnionLocalAndAgreement } from "@/lib/actions";
import { inputClass, labelClass } from "@/components/RfiFields";

/** Records a local and this company's agreement with it in one step.
 *
 * One step on purpose: a local with no agreement is invisible to the
 * company that just typed it in, which reads as the save having failed. */
export function UnionLocalForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Add a local you work under
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createUnionLocalAndAgreement(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
      // On top of the action's own revalidatePath. Browser testing found
      // two of these forms leaving the page stale until a manual reload
      // while the others updated live; every action revalidates and every
      // form calls them the same way, so this is NOT a root-cause fix, it
      // is the one that holds whatever the cause. A save that looks like
      // it did nothing gets clicked again, and no create here is
      // idempotent.
      router.refresh();
          formRef.current?.reset();
          setIsOpen(false);
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h3 className="text-sm font-semibold text-slate-300">Add a local you work under</h3>
      <p className="-mt-1 text-xs text-slate-500">
        Nothing here is seeded — there is no verified list of real local numbers in this app, and a
        wrong entry would attribute your CBA to the wrong hall. If another contractor has already
        recorded this local, yours is added to the same one rather than a duplicate.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          International
          <input
            type="text"
            name="parentInternational"
            required
            placeholder="e.g. United Brotherhood of Carpenters"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Local number
          <input type="text" name="localNumber" required placeholder="e.g. 300" className={inputClass} />
        </label>
        <label className={labelClass}>
          Jurisdiction
          <input
            type="text"
            name="jurisdictionName"
            required
            placeholder="e.g. Northern California"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Trade jurisdiction
          <input
            type="text"
            name="tradeJurisdiction"
            placeholder="Optional — e.g. drywall & lathing"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Agreement in force from
          <input type="date" name="effectiveFrom" required className={inputClass} />
          <span className="text-xs text-slate-500">
            The date on the CBA. Deliberately not pre-filled with today: nearly every real agreement
            started in the past, so a default here is wrong more often than right.
          </span>
        </label>
        <label className={labelClass}>
          In force until
          <input type="date" name="effectiveTo" className={inputClass} />
          <span className="text-xs text-slate-500">Blank means current.</span>
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save local"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
