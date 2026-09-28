"use client";

import { useRef, useState, useTransition } from "react";
import { readBidQuoteDocument, type QuoteSuggestion } from "@/lib/actions";
import { uploadDocumentFile } from "@/lib/document-upload-client";

/**
 * Upload the quote a sub emailed, and have its fields filled in for you.
 *
 * WHAT THIS DOES NOT DO, AND IT IS THE WHOLE DESIGN: save anything. It hands a
 * suggestion to the form above it, the estimator corrects whatever is wrong, and
 * `saveBidQuote` — untouched by this feature — is what writes the row when they
 * press the button they already pressed. There is no "accept" step and no
 * provenance table, because there is never an un-reviewed value in the database
 * to account for: it lives in a form until a person submits it.
 *
 * WHY THE FIELDS ARE FILLED BY REMOUNTING THE FORM rather than by controlling
 * it. `QuoteForm`'s inputs are uncontrolled, with `defaultValue` — which is a
 * reasonable form that has worked for a while, and turning it into a controlled
 * one to support this would rewrite every field in a component that also handles
 * the request shape and the edit shape. Changing its `key` makes React mount a
 * fresh copy with new defaults, which is two lines instead, and leaves the
 * existing shape exactly as it was. The cost is that anything already typed is
 * replaced — which is what a person asking to read the document wants, and the
 * button says so.
 *
 * ONLY ON THE QUOTE SHAPE. A request — "we asked Acme on Monday" — has no
 * amount, date or exclusions to read, so there is nothing for a document to
 * fill.
 */

export function QuoteReader({
  bidInvitationId,
  companyId,
  note,
  onRead,
}: {
  bidInvitationId: string;
  /** The upload is scoped to the COMPANY, not a job: a `BidInvitation` carries
   *  no `jobId`, and on a bid nobody has won there is no job to name. */
  companyId: string;
  /**
   * What the last read cost, HELD BY THE PARENT AND PASSED DOWN — never kept in
   * this component's own state.
   *
   * THIS WAS A REAL DEFECT AND THE REASON IS WORTH THE PARAGRAPH. It was
   * `useState` here, set from `read.value.note` one line before `onRead`. But
   * `onRead` bumps `formKey` in `QuoteForm`, and that key sits on the
   * `ActionForm` that CONTAINS this component — so React unmounted this subtree
   * and mounted a fresh copy whose state was back to `null`. The sentence was
   * computed correctly, returned correctly, set correctly, and thrown away
   * microseconds later by the very remount that fills the fields in. A person
   * was charged a page of their monthly allowance and told nothing.
   *
   * WHAT MADE IT INVISIBLE is the asymmetry: a FAILED read never calls `onRead`,
   * so `formKey` never changes, so `error` below renders perfectly. Every
   * refusal and every failure worked. Only the success message was unreachable,
   * and only on a real mount — so it was invisible to `next dev` reasoning and
   * to every unit test, and it took a click-through on a preview to find.
   *
   * A prop cannot be lost this way: the parent's state survives the remount and
   * flows back in. Do not move it back.
   */
  note: string | null;
  onRead: (suggestion: QuoteSuggestion) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(file: File) {
    setError(null);
    startTransition(async () => {
      // The bytes go straight to the blob store under a one-shot token — never
      // through a Server Action, whose body Next caps at 1MB against a scanned
      // quote's several megabytes (issue #27).
      const uploaded = await uploadDocumentFile("bid-quote", companyId, file);
      if (!uploaded.ok) {
        setError(uploaded.error);
        return;
      }

      const read = await readBidQuoteDocument(bidInvitationId, uploaded.fileUrl, uploaded.fileName ?? file.name);
      if (!read.ok) {
        setError(read.error);
        return;
      }

      // The allowance sentence rides on the suggestion and is rendered from the
      // parent's copy of it — see the `note` prop above for why it is not set
      // here. `onRead` remounts this component, so anything set here would not
      // survive the next line.
      onRead(read.value);
      // Cleared so choosing the SAME file again re-reads it. Without this the
      // input holds the file and `change` never fires a second time, which reads
      // as a dead button after a failed read.
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-1" data-quote-reader="root">
      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Or upload what they sent
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          disabled={isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onPick(file);
          }}
          className="w-64 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body disabled:opacity-50"
        />
        <span className="text-ink-muted">
          {isPending
            ? "Reading it…"
            : "C Stream fills the fields in and you check them. Nothing is saved until you press the button."}
        </span>
      </label>
      {/* Suppressed while a read is in flight, and while the latest one failed:
          the sentence describes a charge that already happened, and standing it
          beside a fresh error would read as that error having cost money. A
          refusal costs nothing — `aiGate` returns before the allowance is
          claimed — and that was confirmed on the preview, allowance unchanged
          across a refused upload. */}
      {note && !isPending && !error && (
        <p className="text-xs text-ink-body" data-quote-reader="note">
          {note}
        </p>
      )}
      {error && (
        <p className="text-xs text-tag-amber-ink" data-quote-reader="error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What the reading could not settle, above the fields it filled.
 *
 * ABOVE, NOT BELOW, and that is `AskProposal`'s convention rather than a layout
 * choice: a caution under the thing it is about is read after the decision has
 * been made. "This quote had two totals on it" has to arrive before somebody
 * glances at the amount box and presses save.
 *
 * It renders NOTHING when the reading was clean, because a panel that always
 * says something teaches people to skip it — the reason `TakeoffCurrencyBanner`
 * is silent on a job with nothing stale.
 */
export function QuoteReadingNotes({ suggestion }: { suggestion: QuoteSuggestion | null }) {
  if (!suggestion) return null;
  const noAmount = suggestion.amount === null;
  if (!suggestion.readingNotes && !noAmount) return null;

  return (
    <div
      className="mb-2 w-full rounded-md border border-line-card bg-surface-card p-2 text-xs text-ink-body"
      data-quote-reader="cautions"
    >
      <p className="font-medium text-ink-label">Check these before you save</p>
      {noAmount && (
        // SAID FIRST, because it is the one a person is most likely to miss: an
        // empty amount box looks like a field nobody filled rather than a
        // deliberate refusal to guess. The extractor is told never to invent a
        // total, and a quote with a range or with separately priced alternates
        // genuinely has none until the estimator decides which are in.
        <p className="mt-1">
          No single total was printed on it, so the amount is blank. Type the figure you are bidding against.
        </p>
      )}
      {suggestion.readingNotes && <p className="mt-1">{suggestion.readingNotes}</p>}
    </div>
  );
}
