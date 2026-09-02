"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPrevailingWageRuleSet } from "@/lib/actions";
import { RuleSetFields } from "@/components/RuleSetFields";
import { localToday } from "@/components/localToday";

export function RuleSetForm() {
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
        Record a rule set
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
          const result = await createPrevailingWageRuleSet(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          // On top of the action's own revalidatePath. Browser testing found
      // two union-compliance forms leaving the page stale until a manual
      // reload while others updated live; every action revalidates and
      // every form calls them the same way, so this is NOT a root-cause
      // fix. It is applied here because these components share that exact
      // pattern, and the same bug would sit unseen until someone hit it.
      // A save that looks like it did nothing gets clicked again, and no
      // create action here is idempotent.
          router.refresh();
          formRef.current?.reset();
          setIsOpen(false);
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Record a rule set</h2>
      <RuleSetFields
        defaults={{
          name: "",
          jurisdiction: "",
          authority: "STATE",
          dailyOvertimeAfterHours: null,
          dailyDoubleTimeAfterHours: null,
          weeklyOvertimeAfterHours: null,
          seventhDayOvertimeAfterHours: null,
          seventhDayDoubleTimeAfterHours: null,
          filingFrequency: "WEEKLY",
          filingDueDays: null,
          formName: null,
          portalUrl: null,
          sourceUrl: null,
          note: null,
          effectiveFrom: localToday(),
          effectiveTo: null,
        }}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save rule set"}
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
