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
//
// AND IT SHOWS THE WHOLE STATEMENT, not just the question. Paragraphs (1),
// (2) and (3) are claims about rebates, permissible deductions, wage
// determinations and apprentice registration; the criminal-prosecution
// warning is part of the document. A form that asked only "how were
// fringes paid?" and then filed all of that under someone's name would be
// obtaining a signature on text the signer never saw. Every word comes
// from lib/wh347-statement.ts, the same module the printed sheet reads, so
// what is shown here and what is filed cannot drift apart.

import { useRef, useState, useTransition } from "react";
import { recordStatementOfCompliance } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { CERTIFIED_PAYROLL_FRINGE_METHODS } from "@/lib/actions/shared";
import {
  WH347_FALSIFICATION_WARNING,
  WH347_FRINGE_CLAUSES,
  WH347_STATEMENT_PARAGRAPH_2,
  WH347_STATEMENT_PARAGRAPH_3,
  wh347FringeClauseApplies,
  wh347StatementParagraph1,
  type Wh347FringeMethod,
} from "@/lib/wh347-statement";

const FRINGE_METHOD_LABEL: Record<Wh347FringeMethod, string> = {
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
  weekStartLabel,
  signerName,
  contractorName,
  projectName,
}: {
  jobId: string;
  /** The week's SUNDAY, in `YYYY-MM-DD`. The action derives the Saturday
   * from it with the same function that lays out the grid, so the filed
   * week and the printed week cannot disagree. */
  weekStart: string;
  /** Only for the sentence the user reads. */
  weekEndingLabel: string;
  weekStartLabel: string;
  /** Whoever is signed in. The action ignores anything posted for this and
   * uses the session — shown here so the person knows whose name goes on
   * the statement before they submit it. */
  signerName: string;
  /** Both go into paragraph (1) verbatim, so the preview reads as the
   * filed page will rather than as a template. */
  contractorName: string;
  projectName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Held in state ONLY so the preview below can mark the right clauses as
  // the user picks. The value that is filed is the posted radio, read from
  // the FormData by the action, so a divergence between this and the form
  // cannot file the wrong answer.
  const [method, setMethod] = useState<Wh347FringeMethod | null>(null);
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
            setMethod(null);
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
        {CERTIFIED_PAYROLL_FRINGE_METHODS.map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="radio"
              name="fringeMethod"
              value={option}
              className="mt-1"
              onChange={() => setMethod(option)}
            />
            <span>{FRINGE_METHOD_LABEL[option]}</span>
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

      {/* What you are actually signing. Not a summary of it. */}
      <div className="rounded-md border border-slate-700 bg-slate-950 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          What you are signing
        </p>
        <div className="mt-2 flex flex-col gap-2 text-[11px] leading-snug text-slate-300">
          <p>
            I, <span className="font-semibold text-slate-100">{signerName}</span>, do hereby state:
          </p>
          <p>
            <span className="font-semibold">(1) </span>
            {wh347StatementParagraph1({
              contractorName,
              projectName,
              periodStartLabel: weekStartLabel,
              periodEndLabel: weekEndingLabel,
            })}
          </p>
          <p>
            <span className="font-semibold">(2) </span>
            {WH347_STATEMENT_PARAGRAPH_2}
          </p>
          <p>
            <span className="font-semibold">(3) </span>
            {WH347_STATEMENT_PARAGRAPH_3}
          </p>
          <p className="font-semibold">(4) That:</p>
          {WH347_FRINGE_CLAUSES.map((clause) => {
            const asserted = method != null && wh347FringeClauseApplies(method, clause.key);
            return (
              <p
                key={clause.key}
                className={asserted ? "border-l-2 border-slate-400 pl-2" : "pl-2 text-slate-600"}
              >
                <span className="font-semibold">
                  [{asserted ? "X" : " "}] {clause.letter} {clause.heading}
                </span>{" "}
                — {clause.body}
              </p>
            );
          })}
          {method == null && (
            <p className="text-amber-300/90">
              Neither clause is marked until you answer the fringe question above. That answer is
              the one part of this statement you are choosing.
            </p>
          )}
          <p className="mt-1 font-bold uppercase leading-tight text-amber-300">
            {WH347_FALSIFICATION_WARNING}
          </p>
        </div>
      </div>

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
