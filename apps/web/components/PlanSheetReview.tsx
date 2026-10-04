"use client";

import { useState, useTransition } from "react";
import { Button } from "@prova/ui";
import { acceptPlanSheets, rejectPlanSheet } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  countSheets,
  duplicateSheetNumbers,
  effectiveSheetNumber,
  effectiveTitle,
  sheetIndexSentence,
  sortForReview,
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

export function PlanSheetReview({ rows }: { rows: SheetRow[] }) {
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
  const [isPending, startTransition] = useTransition();

  const ordered = sortForReview(rows);
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
  const confirmable = ordered.filter((row) => {
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

      {duplicates.length > 0 && (
        // ABOVE THE ROWS, because a caution under the thing it is about is read
        // after the decision has been made — `AskProposal`'s convention and the
        // one the quote reader's cautions follow.
        <p className="rounded-md border border-line-card bg-surface-card p-2 text-xs text-ink-body">
          <span className="font-medium text-ink-label">More than one sheet claims the same number: </span>
          {duplicates.join(", ")}. One of them was misread, or this upload is two sets joined together. An index with
          the same number twice is one nobody can navigate by.
        </p>
      )}

      <ul className="divide-y divide-line-card">
        {ordered.map((row) => {
          const value = valueFor(row);
          const settled = row.proposal && row.proposal.status !== "PROPOSED";
          return (
            <li key={row.pageNumber} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-ink-muted">Sheet {row.pageNumber} of the file</span>

                {!row.proposal ? (
                  <p className="text-sm text-ink-body">
                    {row.hasTextLayer
                      ? "Not read yet."
                      : "This sheet is a scan, so there is no text to read a number off. Type its number on the sheet itself in the viewer."}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex flex-col gap-1 text-xs text-ink-label">
                        Sheet number
                        <input
                          value={value.sheetNumber}
                          disabled={isPending || Boolean(settled)}
                          onChange={(event) => edit(row.proposal!.id, { sheetNumber: event.currentTarget.value })}
                          className="w-32 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body disabled:opacity-60"
                        />
                      </label>
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-label">
                        What it is
                        <input
                          value={value.title}
                          disabled={isPending || Boolean(settled)}
                          onChange={(event) => edit(row.proposal!.id, { title: event.currentTarget.value })}
                          className="w-full rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body disabled:opacity-60"
                        />
                      </label>
                    </div>

                    {/* THE REASON, ALWAYS SHOWN while a row is unsettled. It is the
                        only thing that makes the proposal checkable rather than
                        something to be taken on trust, which is `proposedReason`'s
                        whole purpose: "a reason nobody can check is a reason nobody
                        can overrule." */}
                    {!settled && <p className="text-xs text-ink-muted">{row.proposal.reason}</p>}

                    <p className="text-xs text-ink-muted">
                      {/* A STATUS IS A WORD AND A COLOUR, NEVER A COLOUR — so the
                          confidence is spelled out rather than shown as a dot. */}
                      {row.proposal.status === "ACCEPTED"
                        ? "Confirmed."
                        : row.proposal.status === "REJECTED"
                          ? "Rejected — the reading is kept, so the same set isn't proposed again as though nobody looked."
                          : row.proposal.confidence === "LOW"
                            ? "The reader was NOT sure about this one."
                            : row.proposal.confidence === "MEDIUM"
                              ? "The reader was fairly sure."
                              : "The reader was sure."}
                      {row.proposal.discipline ? ` · ${row.proposal.discipline}` : ""}
                      {row.proposal.scale ? ` · ${row.proposal.scale}` : ""}
                      {row.proposal.revision ? ` · ${row.proposal.revision}` : ""}
                    </p>
                  </>
                )}
              </div>

              {row.proposal && !settled && (
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-ink-label">
                    <input
                      type="checkbox"
                      checked={picked.includes(row.proposal.id)}
                      disabled={isPending}
                      onChange={(event) =>
                        setPicked((was) =>
                          event.currentTarget.checked
                            ? [...was, row.proposal!.id]
                            : was.filter((id) => id !== row.proposal!.id),
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
                        onConfirm={() => reject(row.proposal!.id)}
                      />
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

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
