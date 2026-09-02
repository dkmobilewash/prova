"use client";

import { useState, useTransition } from "react";
import { setJobFunction } from "@/lib/actions";
import { JOB_FUNCTION_LABELS, jobFunctionSummary } from "@/components/permissionLabels";
import { JOB_FUNCTIONS } from "@/lib/permissions";

/** The owner's control for what a teammate's access covers.
 *
 * Saves on change rather than behind a Save button, and shows what the
 * choice actually means underneath. A permissions dropdown whose effect
 * you only discover by asking the person to log in and look is a
 * permissions dropdown people set wrong. */
export function JobFunctionPicker({
  userId,
  current,
}: {
  userId: string;
  current: string | null;
}) {
  const [value, setValue] = useState(current ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={value}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          const formData = new FormData();
          formData.set("jobFunction", next);
          startTransition(async () => {
            const result = await setJobFunction(userId, formData);
            if (!result.ok) {
              setError(result.error);
              setValue(previous);
            }
          });
        }}
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
      >
        <option value="">Full office access (default)</option>
        {JOB_FUNCTIONS.map((fn) => (
          <option key={fn} value={fn}>
            {JOB_FUNCTION_LABELS[fn]}
          </option>
        ))}
      </select>
      <p className="max-w-[18rem] text-right text-xs text-slate-500">
        {jobFunctionSummary(value || null)}
      </p>
      {error && <p className="max-w-[18rem] text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}
