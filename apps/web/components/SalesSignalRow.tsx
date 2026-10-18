"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewSalesLeadSignal, updateSalesLeadSignal } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import {
  SalesSignalFields,
  SIGNAL_KIND_LABELS,
} from "@/components/SalesSignalFields";
import type { SalesSignalKind, SignalState } from "@/lib/sales-qualification";

/**
 * One thing we know, or think we know, with the page it came from.
 *
 * THE SOURCE IS ALWAYS A LINK AND NEVER A BARE URL. A row that printed the
 * address would be unreadable at the width this list renders at, and the title
 * is optional — so the link's text is the title when there is one and the
 * HOSTNAME when there is not, which is the part a person actually judges a
 * source by. `rel="noreferrer"` because these are pages strangers wrote.
 *
 * NO DELETE, DELIBERATELY. A wrong signal is dismissed. CLAUDE.md's evidence
 * rule — sent correspondence closes but never deletes — applies for a reason
 * specific to this record: a dismissed signal is what stops the next search
 * re-proposing the same wrong thing, so deleting it throws away the only copy
 * of "we already looked at this".
 */

export type SalesSignalRowData = {
  id: string;
  kind: SalesSignalKind;
  state: SignalState;
  claim: string;
  sourceUrl: string;
  sourceTitle: string | null;
  disqualifies: boolean;
  /** Null while nobody has reviewed it, or if the reviewer has been deleted. */
  reviewedByName: string | null;
};

const STATE_STYLE: Record<SignalState, string> = {
  PROPOSED: "bg-tag-amber text-tag-amber-ink",
  CONFIRMED: "bg-tag-green text-tag-green-ink",
  DISMISSED: "bg-tag-slate text-tag-slate-ink",
};

/* A status is a WORD and a colour, never a colour — CLAUDE.md's UI rule. */
const STATE_LABEL: Record<SignalState, string> = {
  PROPOSED: "Not checked",
  CONFIRMED: "Confirmed",
  DISMISSED: "Dismissed",
};

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";

/** The host, for when a source has no title. Never throws: the URL was
 *  validated on the way in, but a row written before that guard existed must
 *  still render rather than take the page down. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

export function SalesSignalRow({ signal }: { signal: SalesSignalRowData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function review(decision: "CONFIRMED" | "DISMISSED") {
    setError(null);
    startTransition(async () => {
      const result = await reviewSalesLeadSignal(signal.id, decision);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  /**
   * `onSubmit`, not `<form action={save}>`. React 19 resets a client form
   * submitted through `action` BEFORE the action runs, so the refusal this
   * one can return — a source link that is not a full web address — would
   * arrive over emptied fields and lose the correction being made.
   * `formActionCensus.test.ts` caught it written the wrong way here.
   */
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateSalesLeadSignal(signal.id, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className="border-b border-line-row py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${STATE_STYLE[signal.state]}`}
            >
              {STATE_LABEL[signal.state]}
            </span>
            <span className="text-xs text-ink-muted">
              {SIGNAL_KIND_LABELS[signal.kind]}
            </span>
            {signal.disqualifies && (
              <span className="rounded bg-tag-rose px-1.5 py-0.5 text-xs text-tag-rose-ink">
                Rules them out
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-ink">{signal.claim}</p>

          <p className="mt-1 text-xs text-ink-muted">
            <a
              href={signal.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:text-link-hover"
            >
              {signal.sourceTitle || hostOf(signal.sourceUrl)}
            </a>
            {signal.reviewedByName && (
              <span> · checked by {signal.reviewedByName}</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {/* NOT a `RowActions` cluster, and not a `ConfirmDelete` pair.
              Both exist to manage an ARMED DELETE — hiding the ordinary
              actions while a destructive one is primed, and placing the
              confirm off the pixel the delete vacated. There is no delete on a
              signal: dismissing keeps the row, which is the whole point of it.
              Borrowing that machinery here would imply a danger that is not
              present and cost the row 56px of height on a phone for nothing. */}
          {signal.state === "PROPOSED" ? (
            <>
              <button
                type="button"
                onClick={() => review("CONFIRMED")}
                disabled={pending}
                className={btn}
              >
                {pending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Saving…
                  </span>
                ) : (
                  "Confirm"
                )}
              </button>
              <button
                type="button"
                onClick={() => review("DISMISSED")}
                disabled={pending}
                className={btn}
              >
                Dismiss
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing((open) => !open)}
                disabled={pending}
                className={btn}
              >
                {editing ? "Close" : "Edit"}
              </button>
              {signal.state === "CONFIRMED" && (
                <button
                  type="button"
                  onClick={() => review("DISMISSED")}
                  disabled={pending}
                  className={btn}
                >
                  Dismiss
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-tag-rose-ink">{error}</p>}

      {editing && (
        <form
          onSubmit={save}
          className="mt-3 rounded-md border border-line-card bg-canvas p-3"
        >
          {/* `kind` is not offered: identity locks after creation. The fields
              component takes includeKind={false} for exactly this. */}
          <SalesSignalFields signal={signal} includeKind={false} />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={pending} className={btn}>
              {pending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  Saving…
                </span>
              ) : (
                "Save"
              )}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
