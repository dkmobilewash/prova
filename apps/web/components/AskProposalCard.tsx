"use client";

import Link from "next/link";
import type { ProposalView } from "@/lib/ask/answer";

/** What a confirmed card shows in place of its buttons. */
export type ProposalOutcome = { message: string; created?: { label: string; href: string } };

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-base font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50";

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
 *
 * A HANDOFF card (`handoffHref` set) renders a LINK in the primary's place,
 * styled the same: the tap goes to the page whose form does the write,
 * with the card id in the URL and nothing else. There is nothing to
 * confirm here and nothing in flight, so it is never disabled; `onOpen`
 * lets the panel forget the card as the person leaves.
 */
export function AskProposalCard({
  proposal,
  pending,
  error,
  outcome,
  onConfirm,
  onCancel,
  onOpen,
}: {
  proposal: ProposalView;
  pending: boolean;
  error: string | null;
  outcome: ProposalOutcome | null;
  onConfirm: () => void;
  onCancel: () => void;
  onOpen?: () => void;
}) {
  const settled = outcome !== null;
  const offersButton = !settled && !proposal.existing;
  const handoff = proposal.handoffHref;

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
          <Link href={proposal.existing.href} className="underline hover:text-link">
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

      {handoff && offersButton && (
        <p className="mt-2 text-xs text-ink-body" data-ask="handoff-note">
          Opens the form with these filled in. Nothing is saved until you save it there.
        </p>
      )}

      {outcome && (
        <p className="mt-2 text-sm text-ink" data-ask="outcome">
          {outcome.created && (
            <>
              <Link href={outcome.created.href} className="font-medium underline hover:text-link">
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
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-base text-ink-body hover:border-link hover:text-link disabled:cursor-not-allowed disabled:opacity-50"
          >
            {offersButton ? "Cancel" : "Dismiss"}
          </button>
          {offersButton && handoff && (
            <Link href={handoff} onClick={onOpen} className={PRIMARY} data-ask="handoff">
              {proposal.button}
            </Link>
          )}
          {offersButton && !handoff && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              aria-busy={pending || undefined}
              className={PRIMARY}
            >
              {pending ? "Working…" : proposal.button}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
