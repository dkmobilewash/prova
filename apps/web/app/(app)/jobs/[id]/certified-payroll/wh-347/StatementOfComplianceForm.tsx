"use client";

import { useState, useTransition } from "react";

import { saveWh347Statement } from "@/lib/actions";
import { WH347_FRINGE_MODE_LABEL, type Wh347FringeMode } from "@/lib/wh347-statement";

/**
 * Page 2's facts, on screen.
 *
 * SCREEN ONLY. This sits inside the page's `print:hidden` region, never inside
 * the document sheet — the printed page 2 is rendered separately from the same
 * data. A form that printed would put input boxes on a federal filing.
 *
 * A REAL `<form action={…}>` rather than a hand-built FormData like
 * `IssuePayrollNumberButton` beside it, because this has seven fields and
 * repeatable rows. The action re-renders the page on success (a Server Action
 * POST always renders from the root — CLAUDE.md's #61 entry), so there is no
 * `router.refresh()` here and nothing to reset by hand.
 *
 * NOTHING IS PRE-TICKED. The fringe election opens on "not recorded" even
 * though one of the two is far more common, because a default on this control
 * is the app answering a question the form asks the contractor. Same reason
 * `Das140Panel` does not pre-select an election.
 */

export type StatementFormExceptionRow = {
  id: string;
  craftName: string;
  explanation: string;
};

export function StatementOfComplianceForm({
  jobId,
  weekStartIso,
  signatoryName,
  signatoryTitle,
  fringeMode,
  remarks,
  exceptions,
}: {
  jobId: string;
  weekStartIso: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  fringeMode: Wh347FringeMode | null;
  remarks: string | null;
  exceptions: readonly StatementFormExceptionRow[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // How many exception rows to render. Starts at what is stored, so a saved
  // set comes back editable; a row is added on the client because an empty
  // row is not a record and has no business being written to ask for one.
  const [rowCount, setRowCount] = useState(Math.max(exceptions.length, 0));

  const field =
    "mt-1 w-full rounded-md border border-line-card bg-canvas px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted";
  const label = "flex flex-col text-xs font-medium uppercase tracking-wide text-ink-muted";

  return (
    <form
      /* `onSubmit` + `preventDefault` + `new FormData(event.currentTarget)`,
         NOT `<form action={…}>`. In React 19 the action form RESETS the fields
         BEFORE the action runs, so a returned refusal arrives over an emptied
         form — the person loses seven fields and every exception row and is
         handed an error about text that is no longer on screen.
         `components/LogTimeEntryForm.tsx` is the reference and
         `formActionCensus.test.ts` fails the build on the other shape. I wrote
         the other shape first; the census caught it. */
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        start(async () => {
          const result = await saveWh347Statement(formData);
          if (!result.ok) setError(result.error);
        });
      }}
      className="mt-5 rounded-lg border border-line-card bg-surface p-4"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="weekStart" value={weekStartIso} />

      <h2 className="text-sm font-semibold text-ink">Page 2 — Statement of Compliance</h2>
      <p className="mt-1 text-xs text-ink-muted">
        These are the only parts of page 2 that are not already in your payroll. They print with the
        form.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Who signs it
          <input
            name="signatoryName"
            defaultValue={signatoryName ?? ""}
            placeholder="Full name"
            className={field}
          />
        </label>
        <label className={label}>
          Their title
          <input
            name="signatoryTitle"
            defaultValue={signatoryTitle ?? ""}
            placeholder="Owner, office manager, payroll clerk…"
            className={field}
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className={label}>Fringe benefits — section 4</legend>
        <div className="mt-2 flex flex-col gap-2">
          {(Object.keys(WH347_FRINGE_MODE_LABEL) as Wh347FringeMode[]).map((mode) => (
            <label key={mode} className="flex items-start gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name="fringeMode"
                value={mode}
                defaultChecked={fringeMode === mode}
                className="mt-0.5"
              />
              <span>{WH347_FRINGE_MODE_LABEL[mode]}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          C Stream records the fringe rates and not where the money goes, so this one is yours to
          state. Leave it unselected and the form stays not ready to file.
        </p>
      </fieldset>

      <div className="mt-4">
        <p className={label}>Exceptions — section 4(c)</p>
        <p className="mt-1 text-xs text-ink-muted">
          A craft whose fringes were not paid the way section 4 says, and why. Most weeks have none.
        </p>
        {Array.from({ length: rowCount }).map((_, index) => {
          const row = exceptions[index];
          return (
            <div key={row?.id ?? `new-${index}`} className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr]">
              <input
                name="exceptionCraft"
                defaultValue={row?.craftName ?? ""}
                placeholder="Craft"
                className={field}
              />
              <input
                name="exceptionExplanation"
                defaultValue={row?.explanation ?? ""}
                placeholder="Why this craft is an exception"
                className={field}
              />
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setRowCount((count) => count + 1)}
          className="mt-2 text-xs font-medium text-link hover:underline"
        >
          Add an exception
        </button>
        {rowCount > 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            Clear both boxes on a row to remove it. A craft with no explanation keeps the form from
            being ready.
          </p>
        )}
      </div>

      <label className={`${label} mt-4`}>
        Remarks
        <textarea name="remarks" defaultValue={remarks ?? ""} rows={2} className={field} />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save page 2"}
        </button>
        {error && <p className="text-xs text-tag-rose-ink">{error}</p>}
      </div>
    </form>
  );
}
