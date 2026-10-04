"use client";

import { useState, useTransition } from "react";
import { addIndirectCostLine } from "@/lib/actions";
import { money } from "@/lib/money";
import type { MissingIndirect } from "@/lib/estimating/indirect-costs";

/**
 * "This estimate carries nothing for these."
 *
 * THE SENTENCE DOES NOT NAME THE KINDS, on purpose: the buttons below it name
 * every one of them, so a sentence listing them again would be the same list
 * twice. This docstring used to quote a NAMED version — "…for Cleanup and
 * Dumpsters." — which this component has never rendered, and a dead
 * `missingIndirectsSentence` in `indirect-costs.ts` built exactly that string
 * for nobody. Both are gone; `missingIndirects.test.tsx` now pins that the
 * wording lives in one place and that this is the place.
 *
 * ── WHY A LIST OF BUTTONS AND NOT A WARNING BOX ──
 *
 * The thing that loses money here is a FORGOTTEN indirect, and the audit's own
 * example is a $2,500 mobilization nobody put on the bid. But an estimate with
 * no dumpster line is usually an estimate that needs no dumpster, so this is
 * not a problem to be fixed — it is a question to be answered, and both answers
 * are ordinary.
 *
 * So it is a quiet row of things to add, not amber, not rose, and not a
 * sentence telling anybody they are wrong. `bid-margin.ts` gets rose because a
 * bid under its own cost is a fact; this gets muted because "you have no
 * permits line" is a question. The panel's own rule applies — "a permanent
 * notice is noise that teaches people to stop reading notices" — and this one
 * IS permanent on most estimates, so it has to earn its place by being
 * answerable in one press rather than by shouting.
 *
 * ── WHAT EACH BUTTON SAYS BEFORE IT IS PRESSED ──
 *
 * The company's own figure when it has one, so pressing is a decision rather
 * than a surprise — `UseLaborCostButton` states the same rule. Where the
 * company has catalogued nothing, the button says so: it adds a NAMED line with
 * no cost, which is honest, and `bid-margin.ts` then reports the costless line
 * rather than this component pretending to know what cleanup costs.
 *
 * Dismissing is deliberately not offered. A dismissal would be stored state
 * about a derived question, and the estimator already has two ways to answer —
 * add the line, or leave it and send the bid.
 */
export function MissingIndirects({
  jobId,
  missing,
}: {
  jobId: string;
  missing: MissingIndirect[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  if (missing.length === 0) return null;

  return (
    <section className="mt-3 rounded-md border border-line-row p-3">
      <h4 className="text-sm font-semibold text-ink">General conditions</h4>
      <p className="mt-1 text-xs text-ink-muted">
        This estimate carries nothing for these. Add what applies, or leave them out on purpose — they are
        not required and nothing here is checking up on you.
      </p>

      <ul className="mt-2 flex flex-wrap gap-2">
        {missing.map((item) => (
          <li key={item.kind}>
            <button
              type="button"
              disabled={isPending}
              title={item.covers}
              onClick={() => {
                setError(null);
                setAdding(item.kind);
                startTransition(async () => {
                  const form = new FormData();
                  form.set("kind", item.kind);
                  const result = await addIndirectCostLine(jobId, form);
                  if (!result.ok) setError(result.error);
                  setAdding(null);
                });
              }}
              className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              {isPending && adding === item.kind ? "Adding…" : `+ ${item.label}`}
              {/* WHAT IT WOULD COST, BEFORE THE PRESS. A button that silently
                  put $2,400 on a bid would be the surprise this app refuses
                  everywhere else. */}
              <span className="ml-2 text-ink-muted">
                {item.entry?.defaultBudgetedUnitCost != null
                  ? money(item.entry.defaultBudgetedUnitCost)
                  : "no figure yet"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-xs text-tag-rose-ink">
          {error}
        </p>
      )}
    </section>
  );
}
