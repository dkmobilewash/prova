"use client";

import { useState, useTransition } from "react";
import { Button } from "@prova/ui";
import { acceptPlanSheets, rejectPlanSheet } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { checkDrawingIndex, type IndexCheck } from "@/lib/actions/planSheets";
import {
  countSheets,
  duplicateSheetNumbers,
  effectiveSheetNumber,
  effectiveTitle,
  pageRanges,
  sheetIndexSentence,
  splitForReview,
  type SheetRow,
} from "@/lib/plan-ingest/sheetIndex";

/**
 * THE SHEET INDEX, FOR CHECKING — what was read off each sheet, and what a person
 * says it actually is.
 *
 * NOTHING HERE HAS BEEN ACCEPTED BY A MACHINE, and the screen says so rather than
 * implying it: every row is a proposal until somebody confirms it, and confirming
 * writes the accepted value beside the proposed one rather than over it. That is
 * `AskProposal`'s convention — "a suggestion is not a write, and the tap is the
 * write" — and `DocumentIntake`'s, whose two columns exist so "how often did a
 * person change the answer" stays answerable.
 *
 * LOW CONFIDENCE IS AT THE TOP, and pages with nothing read are above even that.
 * `DocumentIntakeConfidence` made that choice first and gave the reason: HIGH at
 * the bottom "is what makes over-claiming it the expensive mistake". A reader who
 * says HIGH and is wrong has buried their error at the end of a three-hundred-row
 * list.
 *
 * THE ORDERING AND COUNTING ARE NOT IN THIS FILE. They are in
 * `lib/plan-ingest/sheetIndex.ts`, because the unit suite runs in
 * `environment: "node"` and cannot render a component — logic that lives here is
 * logic no test can reach. `jobMediaSelection.ts` is the precedent and its header
 * makes the same argument.
 */

export function PlanSheetReview({ rows, planId }: { rows: SheetRow[]; planId?: string }) {
  /**
   * What each row will be confirmed AS, keyed by proposal id and seeded from the
   * proposal itself.
   *
   * KEYED BY ID, NOT BY INDEX, and `IntakeTable` learned this first: "keyed by id
   * so a re-render after a confirm — which removes rows — cannot shift somebody
   * else's choice onto the wrong document, the way an index-keyed array would." On
   * three hundred sheets that is not a hypothetical.
   */
  const [edits, setEdits] = useState<Record<string, { sheetNumber: string; title: string }>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The set's own printed index, checked on request. Null until asked — see
   *  `checkDrawingIndex`, which opens the plan file. */
  const [indexCheck, setIndexCheck] = useState<IndexCheck | null>(null);
  const [checkingIndex, setCheckingIndex] = useState(false);
  const [isPending, startTransition] = useTransition();

  /**
   * THE ROWS WITH CONTROLS ON THEM, SEPARATED FROM THE ONES WITHOUT.
   *
   * A fifty-five page set rendered fifty-five rows and fifty said only "Not read
   * yet." — no number to check, no title to correct, no Pick and no Reject,
   * because this panel cannot read a sheet. Those fifty pushed the five rows
   * somebody could act on off the top of the screen.
   */
  const { toCheck, notReadYet, scans } = splitForReview(rows);
  const [showRest, setShowRest] = useState(false);
  const counts = countSheets(rows);
  const duplicates = duplicateSheetNumbers(rows);

  function valueFor(row: SheetRow) {
    const id = row.proposal?.id;
    if (!id) return { sheetNumber: "", title: "" };
    return (
      edits[id] ?? {
        sheetNumber: effectiveSheetNumber(row) ?? "",
        title: effectiveTitle(row) ?? "",
      }
    );
  }

  function edit(id: string, patch: Partial<{ sheetNumber: string; title: string }>) {
    setEdits((was) => ({ ...was, [id]: { ...(was[id] ?? { sheetNumber: "", title: "" }), ...patch } }));
  }

  // Only rows that are still PROPOSED and have a number to confirm. A blank one is
  // excluded rather than silently accepted as empty, and the sentence below says
  // how many that leaves — the shape `IntakeTable`'s "Confirm all N" uses.
  const confirmable = toCheck.filter((row) => {
    if (!row.proposal || row.proposal.status !== "PROPOSED") return false;
    return valueFor(row).sheetNumber.trim().length > 0;
  });
  const selected = confirmable.filter((row) => picked.includes(row.proposal!.id));
  const toConfirm = selected.length > 0 ? selected : confirmable;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await acceptPlanSheets(
        toConfirm.map((row) => {
          const value = valueFor(row);
          return {
            proposalId: row.proposal!.id,
            sheetNumber: value.sheetNumber,
            title: value.title.trim() || null,
          };
        }),
      );
      if (!result.ok) setError(result.error);
      else setPicked([]);
    });
  }

  function reject(proposalId: string) {
    setError(null);
    startTransition(async () => {
      const result = await rejectPlanSheet(proposalId);
      if (!result.ok) setError(result.error);
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing has been read from this plan set yet. Read the sheets first, and what each one says will show up here
        to check.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-sheet-review="root">
      <p className="text-sm text-ink-body">{sheetIndexSentence(counts)}</p>

      {/* ── WHAT THE SET SAYS IT CONTAINS ──────────────────────────────
          The counts above say what ARRIVED. Every commercial set also prints
          its own index, and nothing has ever read it — so a set missing four
          sheets has always looked exactly like a complete one. That is the
          expensive direction: a bid priced off an incomplete set wins and then
          meets a drawing nobody read.

          ON REQUEST, because it opens the plan file. */}
      {planId !== undefined && (
        <div data-sheet-review="index-check">
          {indexCheck === null ? (
            <button
              type="button"
              disabled={checkingIndex}
              data-sheet-review="check-index"
              onClick={() => {
                setCheckingIndex(true);
                void checkDrawingIndex(planId)
                  .then(setIndexCheck)
                  .finally(() => setCheckingIndex(false));
              }}
              className="min-h-[36px] self-start rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
            >
              {checkingIndex ? "Reading the index…" : "Check against the set's own index"}
            </button>
          ) : indexCheck.ok === false ? (
            <p className="rounded-md border border-line-card bg-surface p-2 text-xs text-tag-rose-ink">
              {indexCheck.error}
            </p>
          ) : (
            <p
              className={`rounded-md border p-2 text-xs ${
                indexCheck.missing !== null && indexCheck.missing.length > 0
                  ? "border-tag-rose-ink bg-surface text-ink-body"
                  : "border-line-card bg-surface text-ink-body"
              }`}
            >
              {/* MISSING SHEETS ARE NAMED IN THE SENTENCE, not counted — "4
                  sheets are missing" sends somebody back to the index to work
                  out which four, which is the work this was meant to save. */}
              {indexCheck.sentence}
            </p>
          )}
        </div>
      )}

      {duplicates.length > 0 && (
        // ABOVE THE ROWS, because a caution under the thing it is about is read
        // after the decision has been made — `AskProposal`'s convention and the
        // one the quote reader's cautions follow.
        <p className="rounded-md border border-line-card bg-surface p-2 text-xs text-ink-body">
          <span className="font-medium text-ink-label">More than one sheet claims the same number: </span>
          {duplicates.join(", ")}. One of them was misread, or this upload is two sets joined together. An index with
          the same number twice is one nobody can navigate by.
        </p>
      )}

      <ul className="divide-y divide-line-card">
        {toCheck.map((row) => {
          const value = valueFor(row);
          // `toCheck` is the rows that HAVE a proposal, which the type cannot
          // see through the array. Narrowed once here rather than asserted with
          // `!` at each use: an assertion is a claim, and this is a check.
          const proposal = row.proposal;
          if (!proposal) return null;
          const settled = proposal.status !== "PROPOSED";
          return (
            <li key={row.pageNumber} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-ink-muted">Sheet {row.pageNumber} of the file</span>

                {/* No `!row.proposal` branch here any more: `toCheck` is the
                    rows that HAVE one, and the rest are summarised below. The
                    branch that used to live here rendered a row with no control
                    on it at all. */}
                {(
                  <>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex flex-col gap-1 text-xs text-ink-label">
                        Sheet number
                        <input
                          value={value.sheetNumber}
                          disabled={isPending || Boolean(settled)}
                          onChange={(event) => edit(proposal.id, { sheetNumber: event.currentTarget.value })}
                          className="w-32 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body disabled:opacity-60"
                        />
                      </label>
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-label">
                        What it is
                        <input
                          value={value.title}
                          disabled={isPending || Boolean(settled)}
                          onChange={(event) => edit(proposal.id, { title: event.currentTarget.value })}
                          className="w-full rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body disabled:opacity-60"
                        />
                      </label>
                    </div>

                    {/* THE REASON, ALWAYS SHOWN while a row is unsettled. It is the
                        only thing that makes the proposal checkable rather than
                        something to be taken on trust, which is `proposedReason`'s
                        whole purpose: "a reason nobody can check is a reason nobody
                        can overrule." */}
                    {!settled && <p className="text-xs text-ink-muted">{proposal.reason}</p>}

                    <p className="text-xs text-ink-muted">
                      {/* A STATUS IS A WORD AND A COLOUR, NEVER A COLOUR — so the
                          confidence is spelled out rather than shown as a dot. */}
                      {proposal.status === "ACCEPTED"
                        ? "Confirmed."
                        : proposal.status === "REJECTED"
                          ? "Rejected — the reading is kept, so the same set isn't proposed again as though nobody looked."
                          : proposal.confidence === "LOW"
                            ? "The reader was NOT sure about this one."
                            : proposal.confidence === "MEDIUM"
                              ? "The reader was fairly sure."
                              : "The reader was sure."}
                      {proposal.discipline ? ` · ${proposal.discipline}` : ""}
                      {proposal.scale ? ` · ${proposal.scale}` : ""}
                      {proposal.revision ? ` · ${proposal.revision}` : ""}
                    </p>
                  </>
                )}
              </div>

              {!settled && (
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-ink-label">
                    <input
                      type="checkbox"
                      checked={picked.includes(proposal.id)}
                      disabled={isPending}
                      onChange={(event) =>
                        setPicked((was) =>
                          event.currentTarget.checked
                            ? [...was, proposal.id]
                            : was.filter((id) => id !== proposal.id),
                        )
                      }
                    />
                    Pick
                  </label>
                  {/* Two steps, and `ConfirmDelete` places the pair itself — see
                      the "Cancel inherits the delete pixel" entry in CLAUDE.md for
                      why no caller gets to decide that. */}
                  <RowActions
                    destructive={
                      <ConfirmDelete
                        label="Reject"
                        // WHAT LEAVES, AND WHETHER ANYTHING LEAVES THE BUILDING —
                        // `hintCensus` requires this and the reason is the reader:
                        // "Reject" on its own could mean the sheet is removed from
                        // the set, or the file is deleted, or the GC is told
                        // something. It means none of those, and the sentence says
                        // so in the order somebody unsure would ask.
                        describe="Marks this reading as wrong so it isn't offered again. The sheet and the plan file stay exactly as they are, and nobody outside your company is told."
                        onConfirm={() => reject(proposal.id)}
                      />
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── WHAT IS LEFT, IN ONE LINE RATHER THAN FIFTY ROWS ──

          These pages carry no proposal, which means no number to check, no title
          to correct, and no Pick or Reject — this panel cannot read a sheet. The
          only way to give one a number is to type it on the sheet itself in the
          viewer, so a row each was fifty identical dead rows above the five that
          could actually be worked.

          Still REACHABLE rather than hidden: the page numbers are what somebody
          needs to find them in the viewer, and a count with no numbers under it
          would make the next step guesswork. Collapsed by default because the
          work is above it; open, it is a few ranges rather than a list. */}
      {(notReadYet.length > 0 || scans.length > 0) && (
        <div className="rounded-md border border-line-card bg-surface p-2" data-sheet-review="rest">
          <button
            type="button"
            onClick={() => setShowRest((open) => !open)}
            aria-expanded={showRest}
            className="min-h-[36px] text-left text-xs text-ink-body underline hover:text-ink-label"
          >
            {showRest ? "Hide" : "Show"} the {notReadYet.length + scans.length} sheets with nothing read off them
          </button>
          {showRest && (
            <div className="mt-2 flex flex-col gap-2 text-xs text-ink-muted">
              {notReadYet.length > 0 && (
                <p data-sheet-review="not-read">
                  <span className="text-ink-label">Not read yet: </span>
                  {pageRanges(notReadYet)}. Read the sheets again, or type each number on the sheet in the viewer.
                </p>
              )}
              {scans.length > 0 && (
                <p data-sheet-review="scans">
                  <span className="text-ink-label">Scans, with no text to read: </span>
                  {pageRanges(scans)}. There is no number on these to find — type it on the sheet in the viewer.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-tag-amber-ink" data-sheet-review="error">
          {error}
        </p>
      )}

      {confirmable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {/* THE SHARED BUTTON, not hand-rolled classes. `packages/ui/Button.tsx`
              shipped `bg-brand text-white` once — white on the founder-approved
              yellow at 1.53:1, on the component nine pages import — and its own
              header records it. Reaching for the primary treatment by hand is how
              that comes back. */}
          <Button type="button" onClick={confirm} disabled={isPending}>
            {isPending
              ? "Confirming…"
              : selected.length > 0
                ? `Confirm ${selected.length} picked`
                : `Confirm all ${confirmable.length}`}
          </Button>
          {/* SAYS WHAT IS EXCLUDED, the way `IntakeTable` does: a button that
              silently confirms fewer rows than the list shows is one somebody
              trusts once. */}
          {confirmable.length < counts.awaiting && (
            <span className="text-xs text-ink-muted">
              {counts.awaiting - confirmable.length} still need a sheet number typed in before they can be confirmed.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
