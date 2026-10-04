"use client";

import { useRef, useState, useTransition } from "react";
import {
  attachAddendumDocument,
  decideAddendumReference,
  readBidAddendumDocument,
} from "@/lib/actions";
import { uploadDocumentFile } from "@/lib/document-upload-client";
import {
  addendaOverlap,
  normaliseReference,
  overlapSentence,
  type AddendumDecision,
  type AddendumItem,
} from "@/lib/addenda-overlap";

/**
 * WHAT ONE ADDENDUM SAYS IT CHANGED, under the addendum's own row.
 *
 * COLLAPSED BY DEFAULT, and it is the first thing on `/bids` that is. The page
 * renders every bid's compliance panel expanded, with no `take` on the query, so
 * a bid with four addenda of twelve items each would add fifty lines per bid to
 * a list of every bid the company has. The panel's outstanding list is what
 * decides whether anybody reads the number at all, and it must not be pushed off
 * screen by a reading.
 *
 * NOTHING HERE ASSERTS ANYTHING ABOUT THE BID. The checkbox on the row above —
 * "Changed work we had already priced" — is untouched by every control in this
 * file, and so is the acknowledgement. What a person does here is mark which
 * scopes are their problem, which changes no verdict anywhere and is why it can
 * be done quickly without a wrong click costing anything.
 */

export type AddendumReadingView = {
  id: string;
  items: AddendumItem[];
  readingReason: string;
  proposedIssueDateText: string | null;
  proposedBidDateText: string | null;
  /** Rendered as a plain date string by the server — see `viewerDayCensus`. */
  readOn: string;
  pagesCharged: number;
};

export type AddendumFindingsProps = {
  addendumId: string;
  addendumReference: string;
  companyId: string;
  fileName: string | null;
  hasFile: boolean;
  /** The NEWEST reading only. Older ones are superseded and never shown. */
  reading: AddendumReadingView | null;
  /** How many times this addendum has been read, so the button can say what a
   *  re-read costs BEFORE it is pressed rather than after. */
  readCount: number;
  decisions: { normalisedReference: string; decision: AddendumDecision }[];
  /** Every addendum on this bid, so the overlap can be computed. Includes this
   *  one; `addendaOverlap` needs the whole set to find a scope named twice. */
  overlapScope: {
    addendumId: string;
    reference: string;
    items: AddendumItem[];
    decisions: { normalisedReference: string; decision: AddendumDecision }[];
  }[];
};

const CONFIDENCE_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

export function AddendumFindings({
  addendumId,
  addendumReference,
  companyId,
  fileName,
  hasFile,
  reading,
  readCount,
  decisions,
  overlapScope,
}: AddendumFindingsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const decided = new Map(decisions.map((d) => [d.normalisedReference, d.decision]));

  // LOWEST CONFIDENCE FIRST. The items the reader was least sure of are the ones
  // a person most needs to look at, so they are not at the bottom of a list of
  // twenty. Within a confidence band the document's own order is kept, because
  // an addendum's items refer to each other by number.
  const items = [...(reading?.items ?? [])].sort(
    (a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] || a.ordinal - b.ordinal,
  );

  const overlaps = addendaOverlap(
    overlapScope.map((a) => ({
      addendumId: a.addendumId,
      reference: a.reference,
      items: a.items,
      decisions: new Map(a.decisions.map((d) => [d.normalisedReference, d.decision])),
    })),
  );
  const overlapHere = new Map(
    overlaps
      .filter((o) => o.touchedBy.some((t) => t.addendumId === addendumId))
      .map((o) => [o.normalisedReference, o]),
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "That didn't work.");
    });
  }

  async function onPickFile(file: File) {
    setError(null);
    setNote(null);
    const uploaded = await uploadDocumentFile("bid-addendum", companyId, file);
    if (!uploaded.ok) {
      setError(uploaded.error);
      return;
    }
    run(() => attachAddendumDocument(addendumId, uploaded.fileUrl, uploaded.fileName ?? file.name));
  }

  const unread = reading === null;
  const summaryText = unread
    ? hasFile
      ? "Read what this addendum changed"
      : "Attach the PDF to read what it changed"
    : `What it changed — ${items.length} ${items.length === 1 ? "item" : "items"}` +
      (overlapHere.size > 0 ? `, ${overlapHere.size} also in another addendum` : "");

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-ink-muted">{summaryText}</summary>

      <div className="mt-2 rounded-lg border border-line-card bg-surface p-3">
        {!hasFile && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void onPickFile(file);
              }}
            />
            <button
              type="button"
              className="rounded-md border border-line-card px-3 py-2 text-sm"
              disabled={isPending}
              onClick={() => fileInput.current?.click()}
            >
              {isPending ? "Attaching…" : "Attach the PDF"}
            </button>
            <span className="text-xs text-ink-muted">
              Keeping the letter on the bid is worth doing on its own — reading it is a separate step.
            </span>
          </div>
        )}

        {hasFile && unread && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-line-card px-3 py-2 text-sm"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  const result = await readBidAddendumDocument(addendumId);
                  if (result.ok) setNote(result.value.note);
                  return result;
                })
              }
            >
              {isPending ? "Reading…" : "Read it"}
            </button>
            <span className="text-xs text-ink-muted">
              {fileName ?? "The attached PDF"} goes to the assistant and its pages come off this month&rsquo;s
              addendum allowance. It lists what the letter says changed; whether any of it affects what you have
              priced stays your call.
            </span>
          </div>
        )}

        {reading && (
          <>
            <p className="text-xs text-ink-muted">
              Read {reading.readOn} · {reading.pagesCharged}{" "}
              {reading.pagesCharged === 1 ? "page" : "pages"} · {reading.readingReason}
            </p>

            {(reading.proposedIssueDateText || reading.proposedBidDateText) && (
              <p className="mt-2 text-xs text-ink-body">
                {reading.proposedIssueDateText && (
                  <>Dated &ldquo;{reading.proposedIssueDateText}&rdquo; on the document. </>
                )}
                {reading.proposedBidDateText && (
                  <>It says the bid is now due &ldquo;{reading.proposedBidDateText}&rdquo;. </>
                )}
                {/* SHOWN TO BE TYPED IN, NEVER WRITTEN. `bid-addenda.prisma` says
                    why: a model-proposed date becoming a second source of when
                    something was issued is how two screens start disagreeing
                    about whether somebody may build from a drawing. */}
                Check it against the letter and put it in the fields above yourself.
              </p>
            )}

            {items.length === 0 ? (
              <p className="mt-2 text-sm text-ink-body">
                Nothing was read off this document as a change. If that looks wrong, the letter is attached
                above — the reading says: {reading.readingReason}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line-row">
                {items.map((item) => {
                  const key = normaliseReference(item.reference);
                  const decision = decided.get(key);
                  const overlap = overlapHere.get(key);
                  return (
                    <li key={`${item.ordinal}-${item.reference}`} className="py-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        {item.confidence === "LOW" && (
                          <span className="rounded bg-tag-amber-ground px-1.5 py-0.5 text-[11px] text-tag-amber-ink">
                            least sure
                          </span>
                        )}
                        {item.label && <span className="text-xs text-ink-muted">{item.label}</span>}
                        <span className="text-sm font-medium text-ink-label">{item.reference}</span>
                        <span className="text-sm text-ink-body">{item.summary}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {item.reason}
                        {item.sourcePageLabel ? ` · ${item.sourcePageLabel}` : ""}
                      </p>

                      {overlap && (
                        <p className="mt-1 text-xs text-tag-amber-ink">{overlapSentence(overlap)}</p>
                      )}

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {decision === "NOT_MINE" ? (
                          <span className="text-xs text-ink-muted">
                            You marked this as another trade&rsquo;s.{" "}
                            <button
                              type="button"
                              className="underline"
                              disabled={isPending}
                              onClick={() => run(() => decideAddendumReference(addendumId, item.reference, "MINE"))}
                            >
                              Undo
                            </button>
                          </span>
                        ) : decision === "MINE" ? (
                          <span className="text-xs text-ink-muted">
                            Marked as yours.{" "}
                            <button
                              type="button"
                              className="underline"
                              disabled={isPending}
                              onClick={() =>
                                run(() => decideAddendumReference(addendumId, item.reference, "NOT_MINE"))
                              }
                            >
                              Not mine
                            </button>
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="rounded border border-line-card px-2 py-1 text-xs"
                              disabled={isPending}
                              onClick={() => run(() => decideAddendumReference(addendumId, item.reference, "MINE"))}
                            >
                              Mine to price
                            </button>
                            <button
                              type="button"
                              className="rounded border border-line-card px-2 py-1 text-xs"
                              disabled={isPending}
                              onClick={() =>
                                run(() => decideAddendumReference(addendumId, item.reference, "NOT_MINE"))
                              }
                            >
                              Not my scope
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-line-card px-3 py-2 text-sm"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    const result = await readBidAddendumDocument(addendumId);
                    if (result.ok) setNote(result.value.note);
                    return result;
                  })
                }
              >
                {isPending ? "Reading…" : "Read it again"}
              </button>
              <span className="text-xs text-ink-muted">
                {/* SAID BEFORE THE CLICK, not after. A re-read charges again, and
                    the count is the thing a person cannot see for themselves. */}
                Read {readCount} {readCount === 1 ? "time" : "times"} so far. Reading it again charges the
                pages again — worth it if the letter was hard to read, not otherwise. What you have marked
                above is kept.
              </span>
            </div>
          </>
        )}

        {note && <p className="mt-2 text-xs text-ink-muted">{note}</p>}
        {error && <p className="mt-2 text-sm text-tag-rose-ink">{error}</p>}
      </div>
    </details>
  );
}
