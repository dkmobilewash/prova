"use client";

import { useState } from "react";
import {
  acceptProposalDraft,
  dismissProposalDraft,
  draftProposalGapClauses,
  saveClauseToLibrary,
} from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { PROPOSAL_CLAUSE_LABELS } from "@/lib/proposal-clauses";

/**
 * WHAT THE SCOPE LETTER IS SILENT ABOUT.
 *
 * A sub's proposal fails by silence: a requirement the specs state, an indirect
 * nobody priced, a package carried from a sub's quote. A GC reading a letter
 * that does not mention one assumes it was priced. This panel lists them with a
 * drafted sentence and the quote it came from, and nothing reaches the letter
 * until somebody presses accept.
 *
 * ── THE CITATION IS THE POINT OF THE SCREEN ──
 *
 * It is shown above the sentence, not below it and not behind a disclosure,
 * because the question the estimator is answering is "is this true of my
 * number?" — and they cannot answer it from the drafted wording alone. A clause
 * accepted without reading its source is a clause nobody can defend when the GC
 * asks where it came from.
 *
 * ── THE PAIRED CASE ──
 *
 * For a spec requirement, the app CANNOT tell whether the bid priced it, so two
 * drafts arrive sharing one `factRef`: an inclusion and an exclusion. They are
 * grouped under one heading with the citation once, so the estimator reads the
 * requirement and picks, rather than meeting the same quote twice and wondering
 * whether something has gone wrong.
 */

export type ProposalDraftView = {
  id: string;
  kind: "INCLUSION" | "EXCLUSION" | "CLARIFICATION" | "ALTERNATE";
  text: string;
  factKind: string;
  factRef: string;
  citation: string | null;
  status: "PROPOSED" | "ACCEPTED" | "DISMISSED";
  /** True once this clause is in the company's standard set, so the offer is
   *  not made twice. */
  inLibrary: boolean;
};

export function ProposalDrafts({
  jobId,
  drafts,
  gapCount,
  canOfferLibrary,
}: {
  jobId: string;
  drafts: ProposalDraftView[];
  /** How many facts have no draft yet — what pressing the button would write. */
  gapCount: number;
  /** Owners only: the library is a company-wide list every future bid copies. */
  canOfferLibrary: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const proposed = drafts.filter((draft) => draft.status === "PROPOSED");
  const accepted = drafts.filter((draft) => draft.status === "ACCEPTED");

  // Paired drafts — one fact, two opposite sentences — are grouped so the
  // citation is read once and the choice is obvious.
  const groups = new Map<string, ProposalDraftView[]>();
  for (const draft of proposed) {
    const group = groups.get(draft.factRef) ?? [];
    group.push(draft);
    groups.set(draft.factRef, group);
  }

  return (
    <section className="mt-8 rounded-lg border border-line-card bg-surface p-4 print:hidden">
      <h2 className="text-sm font-semibold text-ink">What this letter does not mention</h2>

      {gapCount === 0 && proposed.length === 0 ? (
        <p className="mt-1 text-xs text-ink-body">
          Nothing this app can see is missing from the clauses below.{" "}
          {/* DOING REAL WORK, and the reason `bid-responsiveness.ts` has no
              "compliant" verdict: the app has never read the GC's scope sheet,
              so an empty queue is not a finished letter and must not read like
              one. */}
          <span className="text-ink-muted">
            That is not the same as a complete letter — it has not read the GC&apos;s scope sheet.
          </span>
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-body">
          Each one is something the estimate or the specs already say. A clause here is a suggestion with the
          sentence it came from; nothing reaches the proposal until you accept it.
        </p>
      )}

      {gapCount > 0 && (
        <ActionForm action={() => draftProposalGapClauses(jobId)} className="mt-3">
          <SubmitButton
            type="submit"
            className="min-h-[48px] rounded-md bg-neutral-800 px-4 text-sm font-medium text-ink hover:bg-neutral-700"
          >
            {/* The count before the press, which is the house rule for anything
                that spends an allowance. */}
            Draft clauses for {gapCount} {gapCount === 1 ? "thing" : "things"} not mentioned
          </SubmitButton>
        </ActionForm>
      )}

      {[...groups.entries()].map(([factRef, group]) => (
        <article key={factRef} className="mt-4 rounded-md border border-line-row bg-canvas p-3">
          {group[0].citation !== null && (
            // ABOVE the sentence. The estimator is answering "is this true of
            // my number?", and the drafted wording alone cannot tell them.
            <p className="text-xs italic text-ink-muted">{group[0].citation}</p>
          )}
          {group.length > 1 && (
            <p className="mt-1 text-xs text-tag-amber-ink">
              This app cannot tell whether your number carries this. Pick the one that is true.
            </p>
          )}

          {group.map((draft) => (
            <div key={draft.id} className="mt-2 border-t border-line-row pt-2 first:border-0 first:pt-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {PROPOSAL_CLAUSE_LABELS[draft.kind]}
              </p>

              <ActionForm action={(formData) => acceptProposalDraft(draft.id, formData)} className="mt-1">
                {editing === draft.id ? (
                  // EDITING IS THE POINT OF A REVIEW STEP. The action reads
                  // `text` from the form, so a corrected wording is what lands
                  // on the letter.
                  <textarea
                    name="text"
                    defaultValue={draft.text}
                    rows={3}
                    className="w-full rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink-body"
                  />
                ) : (
                  <>
                    <p className="text-sm text-ink-body">{draft.text}</p>
                    <input type="hidden" name="text" value={draft.text} />
                  </>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SubmitButton
                    type="submit"
                    className="min-h-[48px] rounded-md bg-neutral-800 px-3 text-sm font-medium text-ink hover:bg-neutral-700"
                  >
                    Put it on the proposal
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={() => setEditing(editing === draft.id ? null : draft.id)}
                    className="min-h-[48px] rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-neutral-800"
                  >
                    {editing === draft.id ? "Keep as written" : "Edit the wording"}
                  </button>
                </div>
              </ActionForm>

              <ActionForm action={() => dismissProposalDraft(draft.id)} className="mt-2">
                <SubmitButton
                  type="submit"
                  className="min-h-[48px] rounded-md border border-line-card px-3 text-sm text-ink-muted hover:bg-neutral-800"
                >
                  Not on this letter
                </SubmitButton>
                <p className="mt-1 text-xs text-ink-muted">
                  {/* Said on the button's own row, because a dismissal that
                      silently never came back would look like a bug. */}
                  It will not be suggested again for this job.
                </p>
              </ActionForm>
            </div>
          ))}
        </article>
      ))}

      {accepted.length > 0 && canOfferLibrary && (
        <div className="mt-6 border-t border-line-card pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Keep any of these for next time
          </h3>
          <p className="mt-1 text-xs text-ink-body">
            A clause you use on every bid belongs in your standard set, so it is already there next time.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {accepted
              .filter((draft) => !draft.inLibrary)
              .map((draft) => (
                <li key={draft.id} className="flex flex-wrap items-center gap-2 text-sm text-ink-body">
                  <span className="grow">{draft.text}</span>
                  <ActionForm action={() => saveClauseToLibrary(draft.id)}>
                    <SubmitButton
                      type="submit"
                      className="min-h-[48px] rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-neutral-800"
                    >
                      Add to my standard set
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
