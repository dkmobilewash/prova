"use client";

import { useMemo, useRef, useState } from "react";
import { importCatalogEntries } from "@/lib/actions";
import { MAX_IMPORT_ROWS, parseCatalogImport, splitAgainstExisting } from "@/lib/catalog-import";
import {
  NOMINAL_QUANTITY,
  type LaborReading,
  laborQuestion,
} from "@/lib/catalog-import-labor";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";
import { tradeScopeLabel } from "@/lib/trade-scopes";
import { SubmitButton } from "@/components/SubmitButton";
import { ActionForm } from "@/components/ActionForm";

/**
 * Paste a price list, see exactly what will happen, then commit.
 *
 * The preview is the point. Bulk import is the fastest way to put two
 * hundred wrong numbers into a catalog, and every bid built from that
 * catalog afterwards inherits them — so nothing is written until the user
 * has seen the parsed rows, the ones that will be skipped, and why.
 *
 * Parsing here is for display only. The server re-parses the same text with
 * the same function and decides what to write from that, so what lands can
 * never be something the browser invented.
 *
 * `canImport` DECIDES WHETHER THE CONTROL EXISTS, AND THE ACTION STILL
 * REFUSES — the same cosmetic-versus-boundary split `IntakeForwardBox`
 * documents, and both halves are needed here for a specific reason. The
 * import is owner-only, but `/catalog` admits anyone with MANAGE_ESTIMATING,
 * which is exactly what an ESTIMATOR holds. So the person this page is for
 * could open it, paste two hundred rows out of a supplier's spreadsheet,
 * preview them, click Add — and be refused. Hiding the button is what stops
 * the work being done; the action's refusal is what stops the endpoint
 * answering somebody who posts to it directly.
 *
 * HIDDEN, NOT DISABLED. A disabled button beside a live textarea invites the
 * paste and explains afterwards, which is the same lost afternoon with a
 * tooltip on it. The section is replaced by a sentence saying who can do
 * this, so the answer arrives before the typing does.
 *
 * AND THE SUBMIT GOES THROUGH `<ActionForm>`, NOT `<form action={…}>`. The
 * pasted text is React state in this component and nowhere else. A thrown
 * Server Action message is redacted in production and renders the error
 * boundary, which UNMOUNTS THIS COMPONENT — so every refusal, including
 * "nothing readable to import" on an owner's own mistyped paste, took the
 * paste with it. `importCatalogEntries` returns its refusals now and
 * `ActionForm` renders them beside the textarea, which still has what was
 * typed in it.
 */

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

/* THE HOURS COLUMN IS BACK IN THE SAMPLE, at the 0.012 / 0.03 / 0.02 a real
   drywall price list carries.

   It was pulled out because the app read that column as flat per-line hours,
   so 0.012 against a 600 SF line priced 0.012 hours of labor instead of 7.2 —
   the example had stopped teaching a reading the code did not implement, which
   was the right call while that was true. The import asks which convention the
   column uses now and stores a production rate for the per-unit answer, so the
   example can show the shape people's real files have.

   All three values are under 1, so this sample exercises the PER_UNIT lean and
   arrives with that option pre-selected — deliberately, because the example's
   job is to show what a normal import looks like end to end. */
const SAMPLE = `Description,Unit,Unit Price,Cost,Hours,Trade
5/8" Type X board,SF,2.85,1.90,0.012,drywall
Corner bead,LF,1.20,0.60,0.03,drywall
Level 5 finish,SF,1.75,0.95,0.02,drywall`;

export function CatalogImport({
  existingDescriptions,
  canImport,
}: {
  existingDescriptions: string[];
  canImport: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseCatalogImport(text) : null), [text]);
  const split = useMemo(
    () => (parsed ? splitAgainstExisting(parsed.rows, existingDescriptions) : null),
    [parsed, existingDescriptions],
  );

  /* The Hours-column question, derived from THE SAME function the server uses
     over the same text. The server re-derives it and refuses an unanswered
     import, so this is the readable half of a decision that is enforced
     behind it — not the decision itself. */
  const labor = useMemo(() => (parsed ? laborQuestion(parsed.rows) : null), [parsed]);

  /* Null means unanswered, and it STAYS null when the file's magnitudes do not
     lean — `leanFrom` returns no suggestion inside 1–10, where a door
     assembly's "1.5" is as plausibly hours-per-door as doors-per-hour. The
     submit is disabled until the person picks, rather than a default being
     pre-filled for them to not notice. */
  const [reading, setReading] = useState<LaborReading | null>(null);

  /* Keyed on the file, not on the mount: pasting a DIFFERENT list must not
     inherit the answer given for the last one. `useMemo` recomputes `labor`
     whenever the text changes, so comparing the lean's identity is enough —
     and this runs during render rather than in an effect so the radio and the
     submit button can never disagree for a frame. */
  const leanKey = labor?.kind === "ask" ? `${labor.cell}:${labor.lean.suggested ?? ""}` : "";
  const [seenLean, setSeenLean] = useState(leanKey);
  if (leanKey !== seenLean) {
    setSeenLean(leanKey);
    setReading(labor?.kind === "ask" ? labor.lean.suggested : null);
  }

  const needsReading = labor?.kind === "ask" && reading === null;

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > 1_000_000) {
      setFileError("That file is over 1 MB — split it and import in parts.");
      return;
    }
    try {
      setText(await file.text());
    } catch {
      setFileError("Couldn't read that file. Try opening it and pasting the contents instead.");
    }
  }

  if (!canImport) {
    return (
      <p className="text-sm text-ink-muted">
        Only the account owner can import a price list. You can add entries one at a time below, and
        save any line on a job with &ldquo;Save as catalog item&rdquo;.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
      >
        Import a price list
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">Import a price list</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setFileError(null);
          }}
          className="text-xs text-ink-body hover:text-ink-label"
        >
          Cancel
        </button>
      </div>

      <p className="mb-3 text-xs text-ink-body">
        Paste from a spreadsheet or choose a CSV. The first row must name the columns — one of them
        called <span className="text-ink-label">Description</span> (or Item, or Name). Unit, Price,
        Cost, Hours and Trade are all optional, and column names don&apos;t have to match exactly.
      </p>
      {/* This paragraph used to say "Hours are for the whole line, not per
          unit" and told people to leave the column OUT of the file. That was
          an honest description of a defect: the app read every price list's
          per-unit productivity factor as flat per-line hours. The column is
          read properly now, and the app asks which convention the file uses
          instead of documenting one and doing it regardless. */}
      <p className="mb-3 text-xs text-ink-body">
        <span className="text-ink-label">Keep your Hours column in.</span> It can be hours per unit
        (0.012 hrs per SF), a production rate (83 SF per hour), or flat hours for the whole line —
        whichever your list uses. You&apos;ll be shown what each reading works out to and asked to
        pick before anything is added.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => onFile(event.target.files?.[0])}
          className="text-xs text-ink-body file:mr-3 file:rounded-md file:border file:border-line-card file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:text-ink-label"
        />
        <button
          type="button"
          onClick={() => setText(SAMPLE)}
          className="text-xs text-link hover:underline"
        >
          Show me an example
        </button>
      </div>
      {fileError && <p className="mb-3 text-xs text-tag-rose-ink">{fileError}</p>}

      <textarea
        name="csvPreview"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={"Description,Unit,Unit Price,Cost\n5/8\" Type X board,SF,2.85,1.90"}
        className={`${inputClass} w-full font-mono text-xs`}
      />

      {parsed && split && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-emerald-700 bg-tag-green px-2 py-0.5 text-tag-green-ink">
              {split.fresh.length} to add
            </span>
            {split.duplicatesOfExisting.length > 0 && (
              <span className="rounded-full border border-neutral-400 bg-neutral-800 px-2 py-0.5 text-ink-label">
                {split.duplicatesOfExisting.length} already in the catalog — skipped
              </span>
            )}
            {split.duplicatesWithinFile.length > 0 && (
              <span className="rounded-full border border-neutral-400 bg-neutral-800 px-2 py-0.5 text-ink-label">
                {split.duplicatesWithinFile.length} repeated in the file — skipped
              </span>
            )}
            {parsed.problems.length > 0 && (
              <span className="rounded-full border border-amber-700 bg-tag-amber px-2 py-0.5 text-tag-amber-ink">
                {parsed.problems.length} couldn&apos;t be read
              </span>
            )}
          </div>

          {parsed.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Columns not used: {parsed.ignoredColumns.join(", ")}. If a price is in one of those,
              rename its header and paste again.
            </p>
          )}

          {parsed.problems.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {parsed.problems.slice(0, 8).map((problem) => (
                <li key={`${problem.line}-${problem.message}`} className="text-xs text-tag-amber-ink">
                  Line {problem.line}: {problem.message}
                </li>
              ))}
              {parsed.problems.length > 8 && (
                <li className="text-xs text-ink-muted">
                  …and {parsed.problems.length - 8} more.
                </li>
              )}
            </ul>
          )}

          {/* THE QUESTION, ASKED AS A CONSEQUENCE.
              Every option states what 100 units would take under that
              reading, computed from the figure that would actually be STORED
              — so a rounding loss shows up as a number rather than as a
              footnote. Nobody picks 8,333 hours for a hundred feet of board,
              which is the point: the wrong answer is obvious without knowing
              what a reciprocal is.

              The lean pre-selects only when the magnitudes are decisive (all
              under 1, or all over 10). Inside that band nothing is selected
              and the submit stays disabled — a default there would be a guess
              about a labor figure wearing the appearance of a default. */}
          {labor?.kind === "ask" && (
            <fieldset className="mt-3 rounded-md border border-line-card p-3">
              <legend className="px-1 text-xs font-semibold text-ink-label">
                What does your Hours column mean?
              </legend>
              <p className="text-xs text-ink-body">
                {labor.sample.description} reads{" "}
                <span className="tabular-nums text-ink-label">{labor.cell}</span>
                {labor.sample.unit ? ` in the Hours column, per ${labor.sample.unit}.` : " in the Hours column."}{" "}
                So {NOMINAL_QUANTITY} {labor.sample.unit ?? "units"} would take:
              </p>

              <div className="mt-2 flex flex-col gap-1">
                {labor.consequences.map((option) => (
                  <label
                    key={option.reading}
                    className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-1 text-xs hover:bg-neutral-800"
                  >
                    {/* `laborColumnChoice`, not `laborColumn` — these radios
                        sit OUTSIDE the `<ActionForm>` below, exactly as the
                        visible `csvPreview` textarea does, and the value goes
                        over the wire as a hidden input mirrored from state.
                        Same split, same reason: the controls live with the
                        preview and the form carries one copy of the answer. */}
                    <input
                      type="radio"
                      name="laborColumnChoice"
                      value={option.reading}
                      checked={reading === option.reading}
                      onChange={() => setReading(option.reading)}
                      className="mt-0.5"
                    />
                    <span className="tabular-nums font-semibold text-ink-label">
                      {option.hoursAtNominal != null
                        ? `${formatHours(option.hoursAtNominal)} hrs`
                        : "no labor"}
                    </span>
                    <span className="text-ink-body">
                      {option.reading === "PER_UNIT" && "— hours per unit, the usual price-list column"}
                      {option.reading === "PER_HOUR" && "— units per hour, a production rate"}
                      {option.reading === "FLAT" && "— flat hours for the line, the same at any quantity"}
                      {option.refusal && ` (${option.refusal})`}
                    </span>
                  </label>
                ))}
              </div>

              <p className="mt-2 text-xs text-ink-muted">{labor.lean.because}</p>
              {labor.unusable > 0 && (
                <p className="mt-1 text-xs text-tag-amber-ink">
                  {labor.unusable} of the {labor.carrying} rows with an Hours figure have a zero or
                  negative one, and will import with no labor whichever you pick.
                </p>
              )}
            </fieldset>
          )}

          {split.fresh.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                    {/* "Hours" now, not "Hrs/line": the column shows the cell
                        as the FILE wrote it, and what it means is the question
                        above rather than something this header can assert.
                        Calling it Hrs/line was the old reading stated as a
                        fact in the one place a person checks their figures. */}
                    <th className="px-3 py-2 font-medium">Hours</th>
                    <th className="px-3 py-2 font-medium">Trade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-row">
                  {split.fresh.slice(0, 12).map((row) => (
                    <tr key={row.line} className="text-ink-label">
                      <td className="px-3 py-1.5">{row.description}</td>
                      <td className="px-3 py-1.5 text-ink-body">{row.unit ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.unitPrice != null ? money(row.unitPrice) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.budgetedUnitCost != null ? money(row.budgetedUnitCost) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-ink-body">
                        {row.laborHours ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-ink-body">
                        {tradeScopeLabel(row.tradeScope) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {split.fresh.length > 12 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 12 of {split.fresh.length}. All of them will be added.
                </p>
              )}
            </div>
          )}

          {/* `<ActionForm>`, the shape #414 established for exactly this:
              it posts through onSubmit (React 19 calls requestFormReset
              BEFORE a form's `action` runs, so a refusal lands over fields
              already snapped back), renders what the action returned, and
              resets only on success.

              It matters more here than anywhere else it is used. The pasted
              list is React state in THIS component — a thrown refusal is
              redacted in production and renders the error boundary, which
              unmounts the component and takes the paste with it. That was
              true of "only the account owner can import a price list" at an
              estimator who can legitimately reach /catalog, and equally of
              "nothing readable to import" at an owner's own mistyped paste.
              `resetOnSuccess` is off because there is nothing in this form
              to reset — one hidden input mirrored from state — and clearing
              the textarea is `onSuccess`'s job. */}
          <ActionForm
            action={importCatalogEntries}
            resetOnSuccess={false}
            onSuccess={() => {
              setText("");
              setOpen(false);
            }}
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <input type="hidden" name="csv" value={text} />
            {reading && <input type="hidden" name="laborColumn" value={reading} />}
            <SubmitButton
              type="submit"
              disabled={split.fresh.length === 0 || needsReading}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
            >
              {split.fresh.length === 1 ? "Add 1 entry" : `Add ${split.fresh.length} entries`}
            </SubmitButton>
            {/* DISABLED, not hidden, and this is the one place in this
                component where that is the right way round. The button being
                greyed out beside an unanswered question is the explanation;
                the section above it is already on screen with the three
                outcomes in it, so there is nothing to discover and nothing
                lost by pressing. The action refuses the same case anyway —
                `needsReading` saves a round trip, it is not the guard. */}
            {needsReading && (
              <span className="text-xs text-tag-amber-ink">
                Pick what the Hours column means first.
              </span>
            )}
            <span className="text-xs text-ink-muted">
              Nothing already in the catalog is changed. Up to {MAX_IMPORT_ROWS} rows at a time.
            </span>
          </ActionForm>
        </div>
      )}
    </section>
  );
}
