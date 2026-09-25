import type { DasProposal } from "@/lib/das-forms";

/**
 * What this job looks like it owes — PROPOSED, never created.
 *
 * `lib/das-forms.ts`'s `dasProposals` explains why nothing here writes a row:
 * the record's whole purpose is to say a notice exists, and that is a thing a
 * person asserts. So this renders sentences, each naming the evidence it was
 * reasoned from, and a person clicks.
 *
 * It renders NOTHING when there is nothing to say. An "all clear" panel on a
 * compliance screen is the most dangerous thing on it: a job with no hours
 * logged yet and a job with every notice sent would both show it, and only one
 * of them is fine.
 */
export function DasProposalList({ proposals }: { proposals: readonly DasProposal[] }) {
  if (proposals.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-tag-amber-ink/40 bg-tag-amber/20 p-4">
      <p className="text-sm font-semibold text-tag-amber-ink">
        {proposals.length} {proposals.length === 1 ? "thing" : "things"} this job looks like it owes
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Worked out from this job&rsquo;s own records — that it is public works, that it is contracted,
        and which crafts have hours on it. Nothing below has been created for you: a notice is a
        statement you make, so C Stream says what it noticed and leaves the clicking to you.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {proposals.map((proposal, index) => (
          <li key={`${proposal.kind}-${proposal.craftName}-${index}`} className="text-xs leading-snug">
            <span className="text-ink-label">{proposal.observed}</span>{" "}
            <span className="text-ink-muted">{proposal.suggestion}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
