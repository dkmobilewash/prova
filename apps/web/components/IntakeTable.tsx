"use client";

import { useState, useTransition } from "react";
import { confirmIntakeRows, dismissIntakeRow } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  INTAKE_KINDS,
  INTAKE_KIND_LABELS,
  intakeKindLabel,
  sortForReview,
} from "@/lib/intake/review";
import { formatIntakeSize } from "@/lib/intake/upload";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";

/**
 * The tray: one row per file, the machine's proposal, and a dropdown the
 * person can overrule.
 *
 * THE UNCERTAIN ROWS ARE AT THE TOP, which is the whole design of this
 * screen. Attention is the scarce thing — a superintendent will not read
 * eighty rows — so the ones the classifier is unsure about, and the ones it
 * could not place at all, are the ones you land on. `sortForReview` decides
 * that and is pinned by `lib/intake/review.test.ts`; the order is applied
 * HERE rather than in the query because it is derived from kind and
 * confidence together, and a stored rank could disagree with the two
 * columns it came from.
 *
 * NOTHING FILES ITSELF. "Confirm all" files the rows that have a
 * destination; a row still sitting at "Couldn't place it" is skipped and
 * the button says how many. That is the honest version of the demo and it
 * is also the safe one: the failure this screen must never have is a
 * document filed somewhere nobody chose.
 *
 * THE OVERRIDE IS A PLAIN `<select>`, not a combo box. On camera it opens
 * with one click and shows ten short labels; more importantly it is the
 * control a person already knows, and the thing being demonstrated is that
 * the machine can be overruled — which is only convincing if overruling it
 * is visibly trivial.
 */

export type IntakeRow = {
  id: string;
  fileName: string;
  byteSize: number;
  blobUrl: string;
  proposedKind: string;
  proposedConfidence: string;
  proposedReason: string;
  revisionHint: string | null;
  jobHint: string | null;
  jobId: string | null;
  status: string;
};

/**
 * Re-exported rather than redeclared. This used to be `{ id, name }`, and
 * the picker below rendered `job.name` — issue #65's exact defect, on the
 * one picker in the app that decides where a DOCUMENT lands. `JobOption`
 * requires the GC and the stage, so a page that selects only id and name
 * no longer compiles: the reminder is the build, not a convention.
 */
export type IntakeJob = JobOption;

const CHIP: Record<string, string> = {
  HIGH: "bg-tag-green text-tag-green-ink",
  MEDIUM: "bg-tag-amber text-tag-amber-ink",
  LOW: "bg-tag-rose text-tag-rose-ink",
};

const chipClass = (confidence: string) =>
  `inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
    CHIP[confidence] ?? "bg-tag-slate text-tag-slate-ink"
  }`;

export function IntakeTable({ rows, jobs }: { rows: IntakeRow[]; jobs: IntakeJob[] }) {
  // What each row will file as, seeded from the proposal. Keyed by id so a
  // re-render after a confirm — which removes rows — cannot shift somebody
  // else's choice onto the wrong document, the way an index-keyed array
  // would.
  const [choices, setChoices] = useState<Record<string, { kind: string; jobId: string }>>(() =>
    Object.fromEntries(
      rows.map((row) => [row.id, { kind: row.proposedKind, jobId: row.jobId ?? "" }]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const choiceFor = (row: IntakeRow) =>
    choices[row.id] ?? { kind: row.proposedKind, jobId: row.jobId ?? "" };

  const ordered = sortForReview(rows);
  const placed = ordered.filter((row) => choiceFor(row).kind !== "UNKNOWN");
  const unplaced = ordered.length - placed.length;

  function file(subset: IntakeRow[]) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await confirmIntakeRows(
        subset.map((row) => ({ id: row.id, ...choiceFor(row) })),
      );
      if (result.ok) {
        setNote(
          subset.length === 1
            ? `Filed ${subset[0].fileName}.`
            : `Filed ${subset.length} documents.`,
        );
      } else {
        setError(result.error);
      }
    });
  }

  function dismiss(row: IntakeRow) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await dismissIntakeRow(row.id);
      if (!result.ok) setError(result.error);
      else setNote(`Dismissed ${row.fileName}.`);
    });
  }

  if (rows.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          // Disabled while in flight, because none of these actions is
          // idempotent and this app has a standing scar from create buttons
          // that stayed live through a slow round trip (#19).
          disabled={pending || placed.length === 0}
          onClick={() => file(placed)}
          className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {pending ? "Filing…" : `Confirm all ${placed.length}`}
        </button>
        {unplaced > 0 && (
          <span className="text-sm text-ink-body">
            {unplaced === 1 ? "1 document has" : `${unplaced} documents have`} no destination yet
            and {unplaced === 1 ? "is" : "are"} not included — pick one on the row, or dismiss it.
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-bar-rose px-3 py-2 text-sm text-tag-rose-ink">
          {error}
        </p>
      )}
      {note && !error && <p className="mb-3 text-sm text-ink-body">{note}</p>}

      {/* The table scrolls inside its own box rather than making the page
          scroll sideways. */}
      <div className="overflow-x-auto rounded-lg border border-line-card">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line-card bg-surface text-xs uppercase tracking-wider text-ink-label">
              <th className="px-3 py-2 font-semibold">File</th>
              <th className="px-3 py-2 font-semibold">Filed as</th>
              <th className="px-3 py-2 font-semibold">Job</th>
              <th className="px-3 py-2 font-semibold">Why</th>
              <th className="px-3 py-2 font-semibold">Sure?</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => {
              const choice = choiceFor(row);
              const overridden = choice.kind !== row.proposedKind;
              return (
                <tr key={row.id} className="border-b border-line-card align-top last:border-b-0">
                  <td className="px-3 py-3">
                    <a
                      href={row.blobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-ink underline decoration-line-card underline-offset-2 hover:decoration-ink"
                    >
                      {row.fileName}
                    </a>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {formatIntakeSize(row.byteSize)}
                      {row.revisionHint ? ` · ${row.revisionHint}` : ""}
                    </p>
                  </td>

                  <td className="px-3 py-3">
                    <select
                      value={choice.kind}
                      disabled={pending}
                      onChange={(event) =>
                        setChoices((prev) => ({
                          ...prev,
                          [row.id]: { ...choice, kind: event.target.value },
                        }))
                      }
                      className="min-h-11 w-full rounded-md border border-line-card bg-surface px-2 text-base text-ink disabled:opacity-50"
                    >
                      {INTAKE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {INTAKE_KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                    {overridden && (
                      <p className="mt-1 text-xs text-ink-muted">
                        We said {intakeKindLabel(row.proposedKind)}.
                      </p>
                    )}
                  </td>

                  <td className="px-3 py-3">
                    <select
                      value={choice.jobId}
                      disabled={pending}
                      onChange={(event) =>
                        setChoices((prev) => ({
                          ...prev,
                          [row.id]: { ...choice, jobId: event.target.value },
                        }))
                      }
                      className="min-h-11 w-full rounded-md border border-line-card bg-surface px-2 text-base text-ink disabled:opacity-50"
                    >
                      {/* A blank is a real answer here, not a missing one: a
                          renewed COI or a W-9 belongs to the company rather
                          than to any job. */}
                      <option value="">No job — company paperwork</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {jobPickerLabel(job)}
                        </option>
                      ))}
                    </select>
                    {row.jobHint && !row.jobId && (
                      <p className="mt-1 text-xs text-ink-muted">
                        Looks like &ldquo;{row.jobHint}&rdquo;, which is not a job here.
                      </p>
                    )}
                  </td>

                  <td className="max-w-sm px-3 py-3 text-ink-body">{row.proposedReason}</td>

                  <td className="px-3 py-3">
                    <span className={chipClass(row.proposedConfidence)}>
                      {row.proposedConfidence === "HIGH"
                        ? "Sure"
                        : row.proposedConfidence === "MEDIUM"
                          ? "Fairly sure"
                          : "Not sure"}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    {/* The dismiss is a two-step through the shared
                        component, so arming it hides the Confirm beside it
                        — there is no sibling position left for a hurried
                        second click to land on (#152). `pinned="end"`
                        because this cluster hangs off the right of the row.

                        THE CONFIRMDELETE IS THE `destructive` PROP AND THE
                        ORDINARY ACTION IS THE CHILD, which is not a style
                        choice. RowActions renders `{armed ? null : children}`
                        — put the ConfirmDelete in the children and arming it
                        unmounts IT as well as the button beside it, while the
                        arming state stays true in the parent. The cell empties
                        and neither Confirm nor Cancel can be reached again
                        without a reload. This row shipped that way on this
                        branch and every check in the repo was green;
                        `rowActionsCensus.test.ts` now asks the question. */}
                    <RowActions
                      className="flex shrink-0 items-center justify-end gap-2"
                      destructive={
                        <ConfirmDelete
                          pinned="end"
                          label="Dismiss"
                          confirmLabel="Confirm dismiss"
                          describe="Takes this document off the proposal list without filing it. The file itself is kept and stays marked dismissed, so the same one is not proposed to you again."
                          pending={pending}
                          onConfirm={() => dismiss(row)}
                          hint="It stays on file as dismissed, so the same document is not proposed again."
                          deleteClassName="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-body hover:border-bar-rose hover:text-tag-rose-ink disabled:opacity-50"
                          cancelClassName="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-body hover:border-ink-muted disabled:opacity-50"
                          confirmClassName="shrink-0 rounded-md border border-bar-rose px-3 py-1.5 text-xs text-tag-rose-ink hover:bg-bar-rose/10 disabled:opacity-50"
                        />
                      }
                    >
                      <button
                        type="button"
                        disabled={pending || choice.kind === "UNKNOWN"}
                        onClick={() => file([row])}
                        className="min-h-11 rounded-md border border-line-card px-3 text-xs text-ink hover:border-brand disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    </RowActions>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
