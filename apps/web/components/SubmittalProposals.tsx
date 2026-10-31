"use client";

import { useState, useTransition } from "react";
import { acceptSubmittalProposals, dismissSubmittalProposal } from "@/lib/actions";
import { SUBMITTAL_KIND_LABEL } from "@/lib/submittal-proposals";
import type { SubmittalRequirementKind } from "@prova/integrations/src/submittalRequirements";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";

export type ProposalRow = {
  id: string;
  sectionNumber: string;
  kind: SubmittalRequirementKind;
  requirement: string;
  confidence: string;
  quote: string;
  sourcePageLabel: string | null;
};

/** Draft register rows read off the spec. Nothing is numbered until a person
 * ticks rows and accepts them, and the quote is there so they can check it. */
export function SubmittalProposals({ jobId, proposals }: { jobId: string; proposals: ProposalRow[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [merge, setMerge] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) done?.();
        else setError(result.error ?? "That did not go through.");
      } catch {
        setError("That did not go through. Reload the page and check before trying again.");
      }
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-line-card bg-surface p-4" aria-label="Drafts read from the spec">
      <h2 className="text-sm font-semibold text-ink-label">Drafts read from the spec · {proposals.length}</h2>
      <p className="mt-1 max-w-2xl text-xs text-ink-muted">
        Check each against its quote. Nothing enters the register or takes a number until you accept it, and this lists
        only the sections that were uploaded and read.
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line-row">
        {proposals.map((row) => (
          <li key={row.id} className="flex items-start gap-3 py-2">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-yellow-500"
              aria-label={`Select: ${row.requirement}`}
              checked={picked.includes(row.id)}
              onChange={(event) =>
                setPicked((now) => (event.target.checked ? [...now, row.id] : now.filter((id) => id !== row.id)))
              }
            />
            <div className="min-w-0 flex-1 text-sm text-ink-body">
              <p>
                <span className="font-medium text-ink-label">{SUBMITTAL_KIND_LABEL[row.kind]}</span> · {row.requirement}
              </p>
              <p className="text-xs text-ink-muted">
                {row.sectionNumber}
                {row.sourcePageLabel ? ` · ${row.sourcePageLabel}` : ""}
                {row.confidence === "HIGH" ? "" : ` · ${row.confidence.toLowerCase()} confidence`} · &ldquo;{row.quote}&rdquo;
              </p>
            </div>
            <button
              type="button"
              disabled={isPending}
              className={btn}
              onClick={() =>
                run(
                  () => dismissSubmittalProposal(row.id),
                  () => setPicked((now) => now.filter((id) => id !== row.id)),
                )
              }
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending || picked.length === 0}
          className={btn}
          onClick={() => {
            const form = new FormData();
            for (const id of picked) form.append("proposalId", id);
            if (merge) form.set("merge", "on");
            run(
              () => acceptSubmittalProposals(jobId, form),
              () => {
                setPicked([]);
                setMerge(false);
              },
            );
          }}
        >
          Add {picked.length || ""} to the register
        </button>
        {picked.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-ink-label">
            <input type="checkbox" className="h-5 w-5 accent-yellow-500" checked={merge} onChange={(event) => setMerge(event.target.checked)} />
            Merge these into one submittal
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
