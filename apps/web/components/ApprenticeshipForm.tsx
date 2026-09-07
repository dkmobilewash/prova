"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApprenticeshipEnrollment } from "@/lib/actions";

const field =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none";

export type TeamMember = { id: string; name: string | null; email: string };
export type CraftOption = { id: string; label: string };

/** Registers an indenture.
 *
 * Every field except the three that identify the record is blank by
 * default, and the two hour requirements especially: blank means the
 * programme has not told us, and the review reports that period as
 * unchecked rather than measuring against a number this app invented. */
export function ApprenticeshipForm({
  team,
  crafts,
}: {
  team: TeamMember[];
  crafts: CraftOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
      >
        Register an apprenticeship
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await createApprenticeshipEnrollment(formData);
          if (result.ok) {
            formRef.current?.reset();
            setOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      onInput={() => setError(null)}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Apprentice
          <select name="apprenticeUserId" className={`w-56 ${field}`} defaultValue="">
            <option value="">Choose someone</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Sponsor
          <input name="sponsorName" placeholder="e.g. Carpenters JATC" className={`w-56 ${field}`} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Programme number
          <input name="programNumber" placeholder="optional" className={`w-40 ${field}`} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Date on the indenture
          {/* Deliberately NOT defaulted to today: this is a date on a
              document, routinely weeks before anyone types it in. */}
          <input type="date" name="enrolledOn" className={field} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Craft
          <select
            name="craftClassificationId"
            className={`w-56 ${field}`}
            defaultValue=""
            disabled={crafts.length === 0}
          >
            <option value="">Not recorded</option>
            {crafts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {/* A dropdown whose only option is "Not recorded" is a dead
              control, and this page explains every other empty state. */}
          {crafts.length === 0 && (
            <span className="text-slate-500">
              None yet — add a classification under a local below, then it can be chosen here.
            </span>
          )}
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          OJT hours per period
          <input name="requiredOjtHoursPerPeriod" placeholder="blank" className={`w-32 ${field}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Classroom hours per period
          <input
            name="requiredClassroomHoursPerPeriod"
            placeholder="blank"
            className={`w-32 ${field}`}
          />
        </label>
        <span className="pb-1 text-xs text-slate-500">
          Leave both blank unless the programme has told you. Blank reads as “not looked up”, and
          nothing is measured against it — a made-up target is worse than none.
        </span>
      </div>

      <input name="note" placeholder="Note (optional)" className={field} />

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Register"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
