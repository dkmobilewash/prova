"use client";

import { SCHEDULE_KINDS } from "@prova/integrations/src/scheduleRows";

/**
 * WHAT THE SCHEDULES ON THIS PLAN SET SAY, for a person to read before anything
 * acts on it.
 *
 * `aiSurfaceCensus.test.ts` is the reason this exists as its own component rather
 * than a few lines inside the ingest panel: every AI feature must have a control
 * a page renders, because a feature switch nobody can reach is a switch that
 * silently does nothing. That census also refuses a decoy — the file has to
 * render something that reads as a control.
 *
 * IT SHOWS THE ARITHMETIC OF THE READING, NOT JUST THE RESULT. `gridRowCount`
 * against `readRowCount` is the one number pair that tells a person whether to
 * trust it: sixty lines of grid read as twelve rows either dropped a column of
 * repeated headers or lost half the schedule, and only somebody looking at the
 * sheet can say which. A panel that showed twelve rows and nothing else would
 * hide exactly the failure worth catching.
 *
 * NOTHING HERE POSTS ANYTHING. The rows are a proposal; linking a mark to a
 * measurement is its own decision and deliberately not in this PR.
 */

export type ScheduleProposalRowView = {
  mark: string;
  description: string | null;
  size: string | null;
  quantity: number | null;
  notes: string | null;
};

export type ScheduleProposalView = {
  id: string;
  pageNumber: number;
  /** The sheet number a person accepted, where they have — better than a page
   *  number for finding the drawing on the table in front of them. */
  sheetNumber: string | null;
  kind: string;
  title: string | null;
  rows: ScheduleProposalRowView[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  gridRowCount: number;
  readRowCount: number;
};

/** The band, in words rather than a database level — the same reason
 *  `spec-findings.ts` refuses to shout "MEDIUM" at an estimator. */
const CONFIDENCE_LABEL: Record<ScheduleProposalView["confidence"], string> = {
  HIGH: "clear on the sheet",
  MEDIUM: "worth checking",
  LOW: "least sure — read this one",
};

const KIND_LABEL: Record<string, string> = {
  DOOR: "Door schedule",
  WINDOW: "Window schedule",
  FINISH: "Finish schedule",
  PARTITION: "Partition schedule",
  FIXTURE: "Fixture schedule",
  OTHER: "Schedule",
};

/** Unknown kinds fall back rather than printing a raw enum name at somebody. */
function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? KIND_LABEL.OTHER;
}

export function ScheduleProposals({ proposals }: { proposals: ScheduleProposalView[] }) {
  // Silence on an empty set, which is the convention every advisory surface here
  // follows: a panel that speaks when there is nothing to say teaches people to
  // stop reading it.
  if (proposals.length === 0) return null;

  return (
    <section className="mt-4 rounded-lg border border-line-card bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">Schedules read off this set</h3>
      <p className="mt-1 text-xs text-ink-body">
        Read from the sheets the title blocks called schedules. Nothing here is on your estimate — check the rows
        against the drawing before you use them.
      </p>

      {/* LEAST SURE FIRST. The readings a person most needs to look at are the
          ones the model was least sure of, which is the order `spec-findings.ts`
          uses for the same reason. */}
      {[...proposals]
        .sort((a, b) => bandRank(a.confidence) - bandRank(b.confidence))
        .map((proposal) => (
          <article key={proposal.id} className="mt-4 rounded-md border border-line-row bg-canvas p-3">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink">
                {kindLabel(proposal.kind)}
                {proposal.title !== null && proposal.title !== "" ? ` — ${proposal.title}` : ""}
              </p>
              <p className="text-xs text-ink-muted">
                {proposal.sheetNumber ?? `page ${proposal.pageNumber}`} ·{" "}
                <span className={proposal.confidence === "LOW" ? "text-tag-amber-ink" : undefined}>
                  {CONFIDENCE_LABEL[proposal.confidence]}
                </span>
              </p>
            </header>

            {/* THE PAIR THAT MATTERS. A reader can see at a glance whether the
                reading accounted for the table it was given. */}
            <p className="mt-1 text-xs text-ink-muted">
              {proposal.readRowCount} {proposal.readRowCount === 1 ? "row" : "rows"} read from{" "}
              {proposal.gridRowCount} {proposal.gridRowCount === 1 ? "line" : "lines"} on the sheet
            </p>

            {proposal.rows.length === 0 ? (
              <p className="mt-2 text-sm text-ink-body">
                Nothing was read as a schedule row here. {proposal.reason}
              </p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-line-row">
                  {proposal.rows.map((row, index) => (
                    <li key={`${proposal.id}-${row.mark}-${index}`} className="py-1 text-sm text-ink-body">
                      <span className="font-medium text-ink">{row.mark}</span>
                      {row.size !== null ? ` · ${row.size}` : ""}
                      {row.description !== null ? ` · ${row.description}` : ""}
                      {/* A STATED quantity only. A null means "count the rows",
                          and printing "1" for it would turn an absent figure
                          into a claim the schedule never made. */}
                      {row.quantity !== null ? ` · qty ${row.quantity}` : ""}
                      {row.notes !== null ? <span className="text-ink-muted"> · {row.notes}</span> : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">{proposal.reason}</p>
              </>
            )}
          </article>
        ))}
    </section>
  );
}

function bandRank(confidence: ScheduleProposalView["confidence"]): number {
  if (confidence === "LOW") return 0;
  if (confidence === "MEDIUM") return 1;
  return 2;
}

/** Exported so a test can assert the labels cover the vocabulary the reader can
 *  actually return, rather than whatever this file happened to list. */
export const SCHEDULE_KIND_LABELS = SCHEDULE_KINDS.map((kind) => ({ kind, label: kindLabel(kind) }));
