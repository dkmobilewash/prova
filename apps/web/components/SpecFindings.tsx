"use client";

import { useRef, useState, useTransition } from "react";
import { attachSpecSectionDocument, readSpecSection } from "@/lib/actions";
import { uploadDocumentFile } from "@/lib/document-upload-client";
import {
  CONFIDENCE_WORD,
  SPEC_FINDING_LABEL,
  sortFindingsForReview,
  type SpecFindingView,
} from "@/lib/specs/spec-findings";

/**
 * WHAT A SPEC SECTION DEMANDS THAT COSTS MONEY, under the section's own row.
 *
 * COLLAPSED BY DEFAULT, for `AddendumFindings`'s reason and more so: `/bids`
 * renders every bid's compliance panel expanded with no `take` on the query, and
 * a section can carry twenty findings each with a quote. Four sections on each of
 * twenty bids would add hundreds of lines to a page whose job is to say what
 * would get a bid thrown out.
 *
 * NOTHING HERE ASSERTS ANYTHING ABOUT THE BID, and on this surface that bears
 * repeating because the temptation is sharper than it was for addenda. A finding
 * reads like a thing to tick off — "Level 5 finish: carried / not carried" — and
 * there is deliberately no tick. The model has not seen the estimate, so whether
 * the bid carries a cost is a judgement about numbers it cannot read; and a
 * decision keyed to a model's own prose would be discarded the next time anybody
 * re-read the section, which is the bug the addendum review caught before it
 * shipped. Phase 2 needs a stable key before it gets a tick.
 *
 * THE ORDERING AND LABELLING ARE NOT IN THIS FILE. They are in
 * `lib/specs/spec-findings.ts`, because the unit suite runs in
 * `environment: "node"` and cannot render a component — logic that lives here is
 * logic no test can reach. `sheetIndex.ts` and `jobMediaSelection.ts` both make
 * the same argument in their own headers.
 */

export type SpecReadingView = {
  id: string;
  findings: SpecFindingView[];
  readingReason: string;
  /** Rendered as a plain date string by the server — see `viewerDayCensus`. */
  readOn: string;
  pagesCharged: number;
};

export type SpecFindingsProps = {
  sectionId: string;
  sectionNumber: string;
  companyId: string;
  fileName: string | null;
  hasFile: boolean;
  /** The NEWEST reading only. Older ones are superseded and never shown. */
  reading: SpecReadingView | null;
  /** How many times this section has been read, so the button can say what a
   *  re-read costs BEFORE it is pressed rather than after. */
  readCount: number;
};

export function SpecFindings({
  sectionId,
  sectionNumber,
  companyId,
  fileName,
  hasFile,
  reading,
  readCount,
}: SpecFindingsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const findings = sortFindingsForReview(reading?.findings ?? []);

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
    const uploaded = await uploadDocumentFile("bid-spec-section", companyId, file);
    if (!uploaded.ok) {
      setError(uploaded.error);
      return;
    }
    run(() => attachSpecSectionDocument(sectionId, uploaded.fileUrl, uploaded.fileName ?? file.name));
  }

  function onRead() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await readSpecSection(sectionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote(result.value.note);
    });
  }

  const unread = reading === null;
  const summaryText = unread
    ? hasFile
      ? "Read what this section demands"
      : "Attach the PDF to read what it demands"
    : `What it costs — ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-ink-muted">{summaryText}</summary>

      <div className="mt-2 space-y-2">
        {/* THE MESSAGE USED TO LIVE HERE, AT THE TOP, AND THAT IS WHY IT MOVED.
            From the #604 click-through, step 7b: "you press 'Read it again' at
            the bottom, below 9 findings, but the message appears at the top,
            under the summary line. Someone who just pressed the button probably
            won't see it. It also isn't announced to screen readers."

            Both halves right. The refusal it describes is the gate refusal —
            the one sentence telling an estimator why nothing happened and that
            the owner can switch it back on — and it was rendering off the
            bottom of nine findings' worth of scroll. A refusal nobody reads is
            a dead button, which is the exact failure the ActionResult
            convention exists to prevent; returning the string correctly and
            then putting it where nobody looks loses the same ground at the last
            step.

            So `<Feedback>` renders immediately after whichever control was
            pressed, and carries `role="alert"` so it is announced rather than
            merely present. */}
        {!hasFile && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPickFile(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={isPending}
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Attach the section PDF
            </button>
            <p className="text-xs text-ink-muted">
              Up to 50MB, so a scanned section is fine. Attaching it costs nothing — reading it is a separate
              press.
            </p>
            <Feedback error={error} note={note} />
          </>
        )}

        {hasFile && unread && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={onRead}
              className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              {isPending ? "Reading…" : "Read it"}
            </button>
            <p className="text-xs text-ink-muted">
              {fileName ?? "The attached PDF"} — charged to this month&apos;s spec pages.
            </p>
            <Feedback error={error} note={note} />
          </>
        )}

        {reading && (
          <>
            <p className="text-xs text-ink-muted">
              {/* "charged" is the word, not just "pages" — the #604
                  click-through flagged that the line before the press promises
                  the pages are "charged to this month's spec pages" and the
                  line after it says only "3 pages", so the two do not read as
                  the same fact. The figure a person checks the meter against
                  should name what it is. */}
              Read {reading.readOn} · {reading.pagesCharged}{" "}
              {reading.pagesCharged === 1 ? "page" : "pages"} charged · {reading.readingReason}
            </p>

            {findings.length === 0 ? (
              // AN EMPTY LIST IS A REAL ANSWER AND SAYS SO. A section that
              // demands nothing out of the ordinary is the common case, and
              // "nothing found" must not read as "it did not run".
              <p className="text-xs text-ink-body">
                Nothing in this section was read as a cost above the ordinary. That is a real answer rather
                than a failure — most sections demand what a competent estimator already prices. Read it
                yourself if the number matters.
              </p>
            ) : (
              <ul className="space-y-2">
                {findings.map((finding) => (
                  <li key={`${finding.ordinal}-${finding.label}`} className="text-xs">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {/* EVERY FINDING SAYS HOW SURE IT IS, and before
                          2026-10-04 only the LOW ones did.

                          The old comment here said "only LOW gets a badge, so
                          the badge means 'look here' rather than decorating
                          every row" — which is a real design instinct and was
                          the wrong call. The click-through of #604 returned nine
                          findings, every one of them MEDIUM or HIGH, and so the
                          screen showed NO confidence anywhere. The tester could
                          not check the lowest-first ordering because there was
                          nothing to see, and reported it as unverifiable.

                          That is worse than untidy. This whole feature is built
                          on `DECISIONS.md`'s rule — "a count that is 85%
                          accurate and says so is useful; a count that is 85%
                          accurate and reads as certain is a wrong bid" — and a
                          MEDIUM finding rendered identically to a HIGH one
                          reads as certain. The eval cannot catch it: it reads
                          the `confidence` field, which was correct the whole
                          time. Only a person looking at the screen could, and
                          one did.

                          So the word is always there. The COLOUR is still only
                          on LOW, which keeps the original instinct — the amber
                          means "look here" — while `text-ink-muted` carries the
                          other two. A word and a colour, never a colour, and
                          never neither. */}
                      <span
                        className={
                          finding.confidence === "LOW"
                            ? "rounded bg-tag-amber px-1.5 py-0.5 text-[11px] text-tag-amber-ink"
                            : "text-[11px] text-ink-muted"
                        }
                      >
                        {CONFIDENCE_WORD[finding.confidence]}
                      </span>
                      <span className="font-medium text-ink">{finding.label}</span>
                      <span className="text-ink-muted">{SPEC_FINDING_LABEL[finding.kind]}</span>
                    </div>
                    <p className="mt-0.5 text-ink-body">{finding.requirement}</p>
                    <p className="mt-0.5 text-ink-body">{finding.whyItCosts}</p>
                    {/* THE QUOTE IS THE WHOLE POINT OF THE ROW. A finding
                        nobody can check against the page is a finding nobody
                        can overrule — `intake.prisma`'s standard — and on a
                        thirty-page section the page label is what makes the
                        quote findable. */}
                    <p className="mt-0.5 text-ink-muted">
                      &ldquo;{finding.quote}&rdquo;
                      {finding.sourcePageLabel ? ` · ${finding.sourcePageLabel}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-ink-muted">
              Nothing here has been applied to your bid. Whether your number already carries any of this is
              your call — the reader has not seen your estimate.
            </p>

            <button
              type="button"
              disabled={isPending}
              onClick={onRead}
              className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              {isPending ? "Reading…" : "Read it again"}
            </button>
            {/* WHAT A RE-READ COSTS, SAID BEFORE THE PRESS. `PlanIngestPanel`
                learned this for a paid retry: a button that spends a paid
                allowance must say so while somebody can still not press it. */}
            <p className="text-xs text-ink-muted">
              Read {readCount} {readCount === 1 ? "time" : "times"} so far. Reading it again charges the pages
              again — worth it after a better prompt or a corrected PDF, not for a second opinion.
            </p>
            {/* HERE, under the button that was pressed — not at the top of a
                list nine findings long. See the note above. */}
            <Feedback error={error} note={note} />
          </>
        )}
      </div>
    </details>
  );
}

/**
 * The one place a refusal or a note is rendered, placed beside the control that
 * produced it.
 *
 * `role="alert"` rather than a bare paragraph: the #604 click-through noted the
 * refusal "isn't announced to screen readers", and a gate refusal is the single
 * message in this component a person most needs told. An alert region is
 * announced the moment its content appears, which is exactly the semantics of
 * "you pressed that and here is why nothing happened".
 *
 * Renders nothing at all when there is nothing to say, so no empty live region
 * is left on the page for a reader to land in.
 */
function Feedback({ error, note }: { error: string | null; note: string | null }) {
  if (error === null && note === null) return null;
  return (
    <div role="alert" aria-live="assertive" className="space-y-1">
      {error && <p className="text-xs text-tag-rose-ink">{error}</p>}
      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </div>
  );
}
