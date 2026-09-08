"use client";

// Page 2 of the WH-347 — the Statement of Compliance — as a form.
//
// It is deliberately not a tidy inline row like the rest of the app's
// create forms. This one submits a statement made under penalty of
// perjury, it cannot be edited afterwards and it cannot be deleted (see
// lib/actions/certifiedPayroll.ts for why), so the form says both of those
// things ABOVE the button rather than discovering them for the user
// afterwards. Collapsed behind a button, per the list-page conventions,
// because most visits to this page are to read the grid.

import { useRef, useState, useTransition } from "react";
import { recordStatementOfCompliance } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { CERTIFIED_PAYROLL_FRINGE_METHODS } from "@/lib/actions/shared";

const FRINGE_METHOD_LABEL: Record<(typeof CERTIFIED_PAYROLL_FRINGE_METHODS)[number], string> = {
  APPROVED_PLANS: "4(a) — paid into approved plans (pension, health & welfare, vacation, training)",
  PAID_IN_CASH: "4(b) — paid in cash, directly to the worker",
  BOTH: "Both — some fringes to approved plans, some in cash",
};

const inputClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand focus:outline-none";
const labelClass = "flex flex-col text-sm font-medium text-slate-300";

export function StatementOfComplianceForm({
  jobId,
  weekStart,
  weekEndingLabel,
  signerName,
}: {
  jobId: string;
  /** The week's SUNDAY, in `YYYY-MM-DD`. The action derives the Saturday
   * from it with the same function that lays out the grid, so the filed
   * week and the printed week cannot disagree. */
  weekStart: string;
  /** Only for the sentence the user reads. */
  weekEndingLabel: string;
  /** Whoever is signed in. The action ignores anything posted for this and
   * uses the session — shown here so the person knows whose name goes on
   * the statement before they submit it. */
  signerName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Sign the statement of compliance
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
          // The action returns its failures instead of throwing them —
          // production redacts a thrown Server Action message to a digest.
          const result = await recordStatementOfCompliance(formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="weekStart" value={weekStart} />

      <div>
        <h2 className="text-sm font-semibold text-slate-200">
          Statement of compliance — week ending {weekEndingLabel}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-amber-300/90">
          This is signed under penalty of perjury. Once recorded it cannot be edited or deleted,
          and this week cannot be filed again — correcting a filed payroll takes an amendment,
          which is not built yet. Read it back before you submit.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          It will be recorded as signed by <span className="font-medium text-slate-200">{signerName}</span>{" "}
          — you. Nobody can sign on somebody else&apos;s behalf here.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-300">
          How were fringe benefits paid this week?
        </legend>
        {CERTIFIED_PAYROLL_FRINGE_METHODS.map((method) => (
          <label key={method} className="flex items-start gap-2 text-sm text-slate-300">
            <input type="radio" name="fringeMethod" value={method} className="mt-1" />
            <span>{FRINGE_METHOD_LABEL[method]}</span>
          </label>
        ))}
        <span className="text-xs text-slate-500">
          Deliberately not pre-selected. Which box you tick is the substantive claim on page 2.
        </span>
      </fieldset>

      <label className={labelClass}>
        4(c) exceptions
        <textarea
          name="exceptions"
          rows={3}
          className={inputClass}
          placeholder="Workers or classifications the answer above does not cover. Leave blank if there are none."
        />
        <span className="text-xs text-slate-500">
          Blank means you are stating there were no exceptions, which is part of what you sign.
        </span>
      </label>

      <label className={labelClass}>
        Date signed
        {/* Defaulted to the USER'S calendar date, and only because this
            form is mounted by a click — a server-rendered default would
            break hydration and, west of UTC, pre-fill tomorrow. Change it
            when you are entering a form that was signed on paper earlier:
            the date recorded is the date you type, never the date you
            clicked. */}
        <input type="date" name="signedDate" defaultValue={localToday()} className={inputClass} />
        <span className="text-xs text-slate-500">
          The date on the signature, not today. Backdate it if the form was signed earlier.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" name="isFinal" className="mt-1" />
        <span>
          This is the final payroll for this contract.
          <span className="block text-xs text-slate-500">
            The agency reads this as a statement that no further payroll is coming. A job marked
            complete can still owe one.
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {isPending ? "Recording…" : "Record this statement"}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setIsOpen(false);
          }}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
