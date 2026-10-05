"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importSubListing } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import { parseSubListing } from "@/lib/sub-listing/parse";
import {
  importSummaryFor,
  shouldInclude,
  signalsForSub,
  type PrimeOutcome,
} from "@/lib/sub-listing/signals";
import { leadCandidatesFor, type MatchEvidence } from "@/lib/sub-listing/leadMatch";
import { tradeScopeLabel } from "@/lib/trade-scopes";

/**
 * PASTE A PUBLIC SUBCONTRACTOR LISTING, SEE EXACTLY WHAT WAS READ, IMPORT WHAT
 * IS RIGHT.
 *
 * ── WHY THIS LEADS WITH WHAT IT COULD NOT READ ──
 *
 * The screen's first job is not to show the subcontractors. It is to show
 * whether the reading is COMPLETE, because a listing read as seven subs when it
 * holds eleven produces four prospects nobody will ever know are missing. So the
 * reconciliation sits at the top, above the rows, and a disagreement is stated
 * in a sentence rather than implied by a count.
 *
 * ── THE PARSE HERE IS FOR DISPLAY ──
 *
 * `SpreadsheetImport`'s rule, and it applies with more force to this than to a
 * catalog: the confirm sends **the raw text**, and the server parses it again
 * with the same parser, so what lands can never be something this component
 * invented. The selection travels as LINE NUMBERS — the only thing two parses of
 * the same document are guaranteed to agree about.
 *
 * ── WHY A TEXTAREA AND NOT A FILE UPLOAD ──
 *
 * The obvious move is to accept the PDF. `pdfjs-dist` is already a dependency
 * and `lib/intake/pdf-text.ts` already extracts text in the browser — but it
 * reads the FIRST PAGE ONLY and caps at 4,000 characters. On a listing that runs
 * to a second page, that silently drops subcontractors, which is the one defect
 * this whole feature is built to prevent. A paste cannot truncate without the
 * person seeing it happen.
 *
 * So: paste in slice one, deliberately. PDF belongs here only once it reports
 * truncation as loudly as `unread` does.
 *
 * ── AND WHY IT ASKS WHETHER THE BID WON ──
 *
 * In California the listing is filed WITH THE BID, by EVERY prime. The document
 * cannot tell you whether that prime was awarded the job, so this asks, and
 * defaults to not knowing. It is the difference between a claim that opens a
 * conversation and a claim that congratulates a man on a job he lost.
 */

/**
 * The leads already on file, as this screen needs them. The two identifier
 * columns are here because `leadCandidatesFor` matches on them — without them
 * it falls back to comparing names, and a licence collision with a differently
 * spelled name shows the reviewer nothing at all. `/sales` selects every scalar
 * on the lead, so widening this costs no extra query.
 */
type ExistingLead = {
  id: string;
  companyName: string;
  licenceNumber: string | null;
  registrationNumber: string | null;
};

/**
 * One true sentence per kind of evidence, as a TOTAL record rather than the
 * ternary this used to be. `leadMatch.ts`'s own header explains why: a ternary
 * over a two-value union printed "(similar name)" for everything that was not
 * an exact name match, so adding a licence match to it would have labelled a
 * row whose name is nothing like the lead's as a similar name. A record keyed
 * on `MatchEvidence` fails to compile when a value is added without a label.
 */
const EVIDENCE_LABEL: Record<MatchEvidence, string> = {
  SAME_LICENCE: " (same licence number)",
  SAME_REGISTRATION: " (same DIR registration)",
  SAME_NAME: " (same name)",
  SIMILAR_NAME: " (similar name)",
};

export function SubListingImport({ leads }: { leads: ExistingLead[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [listingText, setListingText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [primeOutcome, setPrimeOutcome] = useState<PrimeOutcome>("UNKNOWN");
  /**
   * Explicit include/exclude, per line. `undefined` means "whatever the trade
   * match suggests".
   *
   * It was a `skipped` set and `checked` was derived as
   * `!skipped[line] && tradeScope !== null`. For a row whose trade did not
   * match, `checked` was already false, so clicking it deleted a key that had
   * never been set, the value recomputed to false, and THE BOX SNAPPED BACK —
   * an inert control with nothing on screen saying so. Since a scope reading
   * "Drywall and ceilings" used to match nothing, the commonest row on the page
   * was the one that could not be imported.
   */
  const [chosen, setChosen] = useState<Record<number, boolean>>({});
  const [attach, setAttach] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(() => parseSubListing(listingText), [listingText]);

  // One of our five trades, or already chosen by hand. An electrical sub on the
  // same form is not a prospect, and making a person untick twelve of them is
  // how they stop reading the list — but every row stays tickable.
  const includes = (row: { line: number; tradeScope: string | null }) =>
    shouldInclude(row, chosen[row.line]);
  const included = parsed.rows.filter(includes);

  /**
   * THE SELECTION IS KEYED BY LINE NUMBER, SO IT DIES WITH THE TEXT IT WAS
   * MADE ON. CLEAR IT HERE OR IT ALIASES ONTO A DIFFERENT SUBCONTRACTOR.
   *
   * This file's own header says the selection travels as line numbers because
   * they are "the only thing two parses of the same document are guaranteed to
   * agree about". That is true, and it is true only of two parses of the SAME
   * document. `chosen` and `attach` are `Record<number, …>` keyed by line, and
   * they used to be cleared in `reset()` alone — on cancel and on success —
   * which means they SURVIVED an edit to the paste. Line 9 is a key into a
   * document that no longer exists.
   *
   * What that cost, which is worse than a wrong tick box: a reviewer picks
   * "Already a lead? → Acme Drywall, Inc." on line 9, setting
   * `attach[9] = acmeLeadId`. They then re-paste a corrected block with one
   * extra line at the top. Line 9 is now Baker Plastering. The `<select>`
   * renders only when `matches.attachable.length > 0`, so if Baker has no
   * attachable candidate THERE IS NO DROPDOWN ON SCREEN AT ALL — and the submit loop
   * still reads `attach[row.line]` unconditionally and sends
   * `attach:9 = acmeLeadId`. Server-side the only checks are that the lead
   * exists and belongs to the company; nothing compares the lead's name to the
   * row's name. Baker Plastering's claims land on Acme Drywall's lead, with
   * nothing anywhere on the screen having said so. `chosen` aliases the same
   * way, more quietly: an explicit untick at line 12 becomes an untick of
   * whatever lands on line 12 next.
   *
   * So re-pasting costs the reviewer their ticks, deliberately. Re-reading a
   * list is the cheap failure; writing one sub's evidence onto another sub's
   * lead is the one this whole feature exists to prevent.
   */
  function setListingTextAndResetSelection(next: string) {
    setListingText(next);
    setChosen({});
    setAttach({});
  }

  function reset() {
    setOpen(false);
    setListingText("");
    setSourceUrl("");
    setSourceTitle("");
    setPrimeOutcome("UNKNOWN");
    setChosen({});
    setAttach({});
    setError(null);
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800"
        >
          Read a subcontractor listing
        </button>
        {done && <p className="text-xs text-tag-green-ink">{done}</p>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData();
        formData.set("listingText", listingText);
        formData.set("sourceUrl", sourceUrl);
        formData.set("sourceTitle", sourceTitle);
        formData.set("primeOutcome", primeOutcome);
        formData.set("lines", included.map((row) => row.line).join(","));
        for (const row of included) {
          const chosen = attach[row.line];
          if (chosen) formData.set(`attach:${row.line}`, chosen);
        }
        setError(null);
        startTransition(async () => {
          const result = await importSubListing(formData);
          if (!result.ok) {
            // Everything typed stays on screen. The source link is the refusal
            // somebody will actually hit, and losing a pasted document to it
            // would be worse than the refusal.
            setError(result.error);
            return;
          }
          const { leadsCreated, leadsAttached, signalsProposed, rowsSkipped } = result.value;
          setDone(
            `${signalsProposed} signal${signalsProposed === 1 ? "" : "s"} to check across ` +
              `${leadsCreated} new lead${leadsCreated === 1 ? "" : "s"}` +
              (leadsAttached > 0 ? ` and ${leadsAttached} you already had` : "") +
              (rowsSkipped > 0 ? `. ${rowsSkipped} row${rowsSkipped === 1 ? "" : "s"} carried nothing checkable and were left out` : "") +
              ".",
          );
          reset();
          router.refresh();
        });
      }}
      className="rounded-md border border-line-card bg-canvas p-4"
    >
      <h3 className="text-sm font-medium text-ink-body">Read a subcontractor listing</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Paste the subcontractor list off a public bid or award document. In California it is the
        &ldquo;Designation of Subcontractors&rdquo; filed with the bid; in Oregon the First-Tier
        Subcontractor Disclosure. A bid tabulation names only the prime bidders, so it has nothing
        to read here.
      </p>

      <label className="mt-4 flex flex-col gap-1 text-xs text-ink-label">
        What the document says
        <textarea
          name="listingText"
          value={listingText}
          onChange={(event) => setListingTextAndResetSelection(event.target.value)}
          rows={8}
          required
          placeholder="Select the subcontractor table in the document and paste it here, column headings and all."
          className="rounded-md border border-line-card bg-surface px-2 py-1 font-mono text-xs text-ink-body"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Link to the document
          <input
            type="url"
            name="sourceUrl"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            required
            placeholder="https://…"
            className="rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
          />
          <span className="text-ink-muted">
            Required. Every signal from this listing carries it, because a claim with no page behind
            it gets read as a fact on a call.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What to call the page (optional)
          <input
            type="text"
            name="sourceTitle"
            value={sourceTitle}
            onChange={(event) => setSourceTitle(event.target.value)}
            placeholder="Riverside USD — Lincoln Elementary award packet"
            className="rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
          />
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs text-ink-label">
          Did the prime on this form win the job?
        </legend>
        <div className="mt-1 flex flex-col gap-1 text-xs text-ink-body">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="primeOutcome"
              checked={primeOutcome === "UNKNOWN"}
              onChange={() => setPrimeOutcome("UNKNOWN")}
            />
            Not sure — this is a listing filed with a bid
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="primeOutcome"
              checked={primeOutcome === "AWARDED"}
              onChange={() => setPrimeOutcome("AWARDED")}
            />
            Yes — I am reading an award, and this prime got it
          </label>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          A listing is filed with the bid by every prime, so most of the subs on one are not on the
          job. Saying you are not sure keeps the claims honest.
        </p>
      </fieldset>

      {listingText.trim() && (
        <div className="mt-4 border-t border-line-row pt-4">
          {/* The reconciliation leads, above the rows. A reading that lost a
              subcontractor is the only failure here nobody would notice. */}
          {parsed.problems.map((problem) => (
            <p key={problem} className="text-xs text-tag-rose-ink">
              {problem}
            </p>
          ))}

          {/* THE PARTITION BROKE, WHICH IS OUR BUG AND NOT THE DOCUMENT'S.
              `accountedFor` is the sum of the four buckets and `parse.ts` says
              in its own header that it "must equal `nonBlankLines` — if it
              does not, this parser has a hole and the screen must say so
              rather than imply completeness". Nothing said so: until now the
              screen never read this number at all. It is separated from the
              `unread` line below on purpose — an unread line is a sentence
              about the document, and the reviewer can go and look at it; this
              is a sentence about the reader, and there is nothing on the page
              for them to check. Impossible by construction today (each line is
              pushed into exactly one bucket), which is precisely why it needs
              a visible failure rather than an assumption: the next person to
              add a bucket is the one who will find out. */}
          {parsed.reconciliation.accountedFor !== parsed.reconciliation.nonBlankLines && (
            <p className="text-xs text-tag-rose-ink">
              Only {parsed.reconciliation.accountedFor} of{" "}
              {parsed.reconciliation.nonBlankLines} lines were accounted for. That is a bug in
              the reader, not a problem with your document &mdash; do not trust this list, it may
              be missing subcontractors that are on the page. Send the text you pasted along with
              this message.
            </p>
          )}

          {parsed.unread.length > 0 && (
            <p className="text-xs text-tag-rose-ink">
              {parsed.unread.length} line{parsed.unread.length === 1 ? "" : "s"} could not be read.
              Check {parsed.unread.length === 1 ? "it" : "them"} against the document before
              trusting this list &mdash; a sub who was never read is a sub nobody notices is
              missing.
            </p>
          )}

          {/* THE GREEN SENTENCE IS `agreed`, NOT A SECOND OPINION ABOUT IT.
              This read `parsed.unread.length === 0`, which is one of the three
              conjuncts of `reconciliation.agreed` — so a document-level
              `problem` (a multi-prime packet is the one that happens) printed
              the rose problem line and this green "all N lines accounted for"
              sentence AT THE SAME TIME, and a reviewer who reads the
              reassurance last reads it as the verdict. A broken partition did
              the same, silently.

              And the other half, which is why this is a fix and not a tidy-up:
              `agreed` exists to detect a broken partition, and `.agreed` was
              referenced by `parse.test.ts` and by NOTHING ELSE — no screen, no
              action. CLAUDE.md's "written, documented, and never called", with
              the twist that the uncalled thing was a FIELD whose only job is
              to be consulted. If the partition had ever broken, the field that
              noticed would have been read by nobody.

              So the completeness verdict is computed in one place and rendered
              here. A new conjunct in `agreed` reaches this sentence with no
              edit to this file, which is the point. */}
          {parsed.reconciliation.agreed && (
            <p className="text-xs text-tag-green-ink">
              All {parsed.reconciliation.nonBlankLines} lines accounted for &mdash;{" "}
              {parsed.reconciliation.rowsParsed} subcontractor
              {parsed.reconciliation.rowsParsed === 1 ? "" : "s"},{" "}
              {parsed.reconciliation.headerLines} header, {parsed.reconciliation.ignoredLines} set
              aside.
            </p>
          )}

          {parsed.unread.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {parsed.unread.map((line) => (
                <li key={line.line} className="text-xs text-ink-muted">
                  <span className="font-mono">line {line.line}</span>: {line.why}
                  <span className="block font-mono text-ink-label">{line.text.trim()}</span>
                </li>
              ))}
            </ul>
          )}

          {parsed.ignored.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-label">
                {parsed.ignored.length} line{parsed.ignored.length === 1 ? "" : "s"} set aside
                &mdash; see why
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {parsed.ignored.map((line) => (
                  <li key={line.line} className="text-xs text-ink-muted">
                    <span className="font-mono">line {line.line}</span>: {line.why}
                    <span className="block font-mono text-ink-label">{line.text.trim()}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {(
              [
                ["Project", parsed.header.project],
                ["Agency", parsed.header.agency],
                ["Prime on this form", parsed.header.prime],
                ["Bid opened", parsed.header.bidDate],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-ink-label">{label}</dt>
                <dd className={value ? "text-ink-body" : "text-ink-muted"}>
                  {value ?? "not on the page"}
                </dd>
              </div>
            ))}
          </dl>

          {parsed.rows.length === 0 ? (
            <p className="mt-4 text-xs text-ink-muted">
              No subcontractors read yet. A listing usually has a licence or registration number on
              each row &mdash; if yours does not, paste a few more columns.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {parsed.rows.map((row) => {
                const matches = leadCandidatesFor(
                  { name: row.name, licence: row.licence, registration: row.registration },
                  leads,
                );
                const proposals = signalsForSub(row, parsed.header, primeOutcome);
                const checked = includes(row);
                return (
                  <li key={row.line} className="rounded-md border border-line-card p-3">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setChosen((current) => ({ ...current, [row.line]: event.target.checked }))
                        }
                        // `h-4 w-4` is the codebase's row-checkbox size (AskProposalCard,
                        // BidCompliance, LeadSearch). Without it this box renders at the
                        // browser default 13x13 — measured in real Chromium at 1280 AND
                        // 375, because no test here can see it: the screen suite runs in
                        // happy-dom, which does no layout and returns zeros from
                        // getBoundingClientRect. `shrink-0` because the sibling is
                        // `min-w-0 flex-1` and would otherwise squeeze it at phone width.
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-label={`Add ${row.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-body">{row.name}</p>
                        <p className="text-xs text-ink-label">
                          {row.tradeScope ? (
                            <span className="font-medium text-ink-body">
                              {tradeScopeLabel(row.tradeScope)}
                            </span>
                          ) : (
                            <span className="text-ink-muted">not one of our five trades</span>
                          )}
                          {row.portionOfWork ? ` · ${row.portionOfWork}` : ""}
                          {row.city ? ` · ${row.city}` : ""}
                        </p>
                        <p className="mt-1 font-mono text-xs text-ink-muted">
                          line {row.line}: {row.sourceText}
                        </p>

                        {row.concerns.length > 0 && (
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {row.concerns.map((concern) => (
                              <li key={concern} className="text-xs text-tag-amber-ink">
                                {concern}
                              </li>
                            ))}
                          </ul>
                        )}

                        <p className="mt-1 text-xs text-ink-label">
                          {importSummaryFor(row, parsed.header, primeOutcome)}
                        </p>

                        {proposals.length > 0 && checked && (
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {proposals.map((proposal) => (
                              <li key={proposal.kind} className="text-xs text-ink-muted">
                                {proposal.claim}
                              </li>
                            ))}
                          </ul>
                        )}

                        {matches.attachable.length > 0 && (
                          <label className="mt-2 flex flex-col gap-1 text-xs text-ink-label">
                            Already a lead?
                            <select
                              name={`attach:${row.line}`}
                              value={attach[row.line] ?? ""}
                              onChange={(event) =>
                                setAttach((current) => ({ ...current, [row.line]: event.target.value }))
                              }
                              className="rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
                            >
                              <option value="">No — add a new lead</option>
                              {matches.attachable.map((candidate) => (
                                <option key={candidate.lead.id} value={candidate.lead.id}>
                                  {candidate.lead.companyName}
                                  {EVIDENCE_LABEL[candidate.evidence]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {/* A lead the DOCUMENTS say is not this row: both printed an
                            identifier of the same kind and they disagree. It is
                            deliberately not in the dropdown — attaching would weld two
                            firms together — and equally deliberately not hidden, because
                            one of the two numbers may be a transposed digit somebody
                            needs to go and fix. Both are printed so they can check. */}
                        {matches.differentRegistrant.map((other) => (
                          <p key={other.lead.id} className="mt-2 text-xs text-tag-amber-ink">
                            {other.lead.companyName} is already a lead with {other.kind}{" "}
                            {other.existing}; this row prints {other.listed}. Different
                            registrants, so it is not offered above &mdash; if one of the two
                            is a typo, fix it on the lead first.
                          </p>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-tag-rose-ink">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending || included.length === 0}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-60"
        >
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Adding…
            </span>
          ) : (
            `Add ${included.length} subcontractor${included.length === 1 ? "" : "s"}`
          )}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
