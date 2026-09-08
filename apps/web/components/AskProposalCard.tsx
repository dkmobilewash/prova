"use client";

import Link from "next/link";
import type { ProposalView } from "@/lib/ask/answer";

/** What a confirmed card shows in place of its buttons. */
export type ProposalOutcome = { message: string; created?: { label: string; href: string } };

/**
 * The card a command puts in front of a person.
 *
 * Everything on it was computed on the server and sent down; nothing on it
 * is editable, and the only thing that goes back up on a tap is the
 * proposal id. That is the whole safety of the write path: the browser
 * cannot change what will be executed, only whether.
 *
 * Button geometry follows CLAUDE.md's armed-delete rule in spirit even
 * though nothing here is destructive: the cluster is new below the text,
 * so no pixel is vacated; Cancel is first and the primary is last and
 * right-pinned; both are 44px tall for a thumb; the primary is disabled
 * while a confirm is in flight and there is no automatic retry, because a
 * confirm that timed out may have landed (the row's claim says so, not the
 * response), and a second tap is exactly the duplicate this app has paid
 * for before.
 */
export function AskProposalCard({
  proposal,
  pending,
  error,
  outcome,
  onConfirm,
  onCancel,
}: {
  proposal: ProposalView;
  pending: boolean;
  error: string | null;
  outcome: ProposalOutcome | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const settled = outcome !== null;
  const offersButton = !settled && !proposal.existing;

  return (
    <div
      className="mt-3 rounded-lg border border-line-card bg-canvas p-3"
      data-ask="proposal"
      aria-live="polite"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-label">
        {settled ? "Done" : proposal.existing ? "Already exists" : proposal.title}
      </p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {proposal.preview.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-ink-body">{line.label}</dt>
            <dd className="min-w-0 break-words text-ink">{line.value}</dd>
          </div>
        ))}
      </dl>

      {proposal.warnings.length > 0 && (
        <ul className="mt-2 text-xs text-tag-amber-ink">
          {proposal.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {proposal.existing && !settled && (
        <p className="mt-2 text-sm text-ink">
          <Link href={proposal.existing.href} className="underline hover:text-brand">
            {proposal.existing.label}
          </Link>
          . Nothing was created.
        </p>
      )}

      {proposal.alsoRequested.length > 0 && !settled && (
        <p className="mt-2 text-xs text-ink-body">
          One thing at a time: ask for the rest once this one is done.
        </p>
      )}

      {outcome && (
        <p className="mt-2 text-sm text-ink" data-ask="outcome">
          {outcome.created && (
            <>
              <Link href={outcome.created.href} className="font-medium underline hover:text-brand">
                {outcome.created.label}
              </Link>{" "}
            </>
          )}
          {outcome.message}
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm text-tag-rose-ink" aria-live="polite">
          {error}
        </p>
      )}

      {!settled && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-base text-ink-body hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {offersButton ? "Cancel" : "Dismiss"}
          </button>
          {offersButton && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              aria-busy={pending || undefined}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Working…" : proposal.button}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
