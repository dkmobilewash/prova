"use client";

import { useState, useTransition } from "react";
import { applyEstimatePriceUpdate, previewEstimatePriceUpdate } from "@/lib/actions";
import type { PriceRefreshPreview } from "@/lib/actions/priceRefresh";
import { KEPT_REASON_TEXT, updateToken, type Figure } from "@/lib/estimating/price-refresh";
import { money } from "@/lib/money";
import { Spinner } from "@/components/Spinner";

/**
 * "Update prices on this estimate" — the two-step door from the price book to
 * the lines of a bid that is still open.
 *
 * Step one only READS: it lists every line whose price book item no longer
 * agrees with it, old -> new, with what that does to the bid. Step two writes
 * the lines still ticked. Nothing is written by opening the list.
 *
 * Estimate-stage jobs only (the page mounts it inside that branch, and the
 * action refuses anything else). Lines nobody linked to a price book item are
 * listed as kept, never offered.
 *
 * WHY EVERY ROW HAS A TICK. A line does not record the price it was generated
 * at, and an edit leaves no mark, so a linked line whose price somebody set on
 * purpose looks exactly like a stale one. The screen says so, and the person
 * unticks theirs.
 */

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;

function Move({ figure }: { figure: Figure | null }) {
  if (!figure) return <span className="text-ink-muted">—</span>;
  const pct =
    figure.old != null && figure.old !== 0 ? Math.round(((figure.next - figure.old) / figure.old) * 1000) / 10 : null;
  return (
    <span className="tabular-nums">
      {figure.old != null ? money(figure.old) : "none"} → <span className="font-semibold text-ink">{money(figure.next)}</span>
      {pct != null && (
        <span className={pct > 0 ? " text-tag-amber-ink" : " text-tag-green-ink"}>
          {" "}
          ({pct > 0 ? "+" : ""}
          {pct}%)
        </span>
      )}
    </span>
  );
}

export function UpdatePricesPanel({ jobId }: { jobId: string }) {
  const [preview, setPreview] = useState<PriceRefreshPreview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function open() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await previewEstimatePriceUpdate(jobId);
      if (!result.ok) return setError(result.error);
      setPreview(result.value);
      setTicked(new Set(result.value.plan.updates.map((u) => u.lineId)));
    });
  }

  function apply() {
    if (!preview) return;
    const chosen = preview.plan.updates.filter((u) => ticked.has(u.lineId));
    const signature = chosen.map(updateToken).sort().join("|");
    setError(null);
    startTransition(async () => {
      const result = await applyEstimatePriceUpdate(
        jobId,
        chosen.map((u) => u.lineId),
        signature,
      );
      if (!result.ok) return setError(result.error);
      setDone(`Updated ${result.value.updated} line${result.value.updated === 1 ? "" : "s"} to today's price book.`);
      setPreview(null);
    });
  }

  const plan = preview?.plan ?? null;
  const chosen = plan ? plan.updates.filter((u) => ticked.has(u.lineId)) : [];
  const priceEffect = chosen.reduce((sum, u) => sum + u.priceEffect, 0);
  const costEffect = chosen.reduce((sum, u) => sum + u.costEffect, 0);

  return (
    <section className="mb-10 rounded-lg border border-line-card bg-surface p-4" data-testid="update-prices">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Price book changes</h2>
        {!plan && (
          <button
            type="button"
            onClick={open}
            disabled={isPending}
            className="rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:opacity-50"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner />
                Checking…
              </span>
            ) : (
              "Update prices on this estimate"
            )}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-body">
        A line keeps the price it was given until you say otherwise. This lists the lines whose price book item has a
        different price today, and changes only the ones you confirm.
      </p>
      {done && <p className="mt-2 text-sm text-tag-green-ink">{done}</p>}
      {error && <p className="mt-2 text-sm text-tag-rose-ink">{error}</p>}

      {plan && (
        <div className="mt-3">
          {plan.updates.length === 0 ? (
            <p className="text-sm text-ink-body">
              Every line linked to your price book already matches it
              {plan.current > 0 ? ` (${plan.current} checked)` : ""}. Nothing to update.
            </p>
          ) : (
            <>
              <p className="text-xs text-ink-body">
                This estimate doesn&rsquo;t remember what price a line was given, so these are the lines that
                differ from the price book today. If you typed a price on one of them on purpose, untick it.
              </p>
              {plan.priceHeldForRecap && (
                <p className="mt-2 text-xs text-tag-amber-ink">
                  Your bid recap has been applied to the line prices, so they carry your markup and are not touched
                  here — only the cost changes. After updating, press &ldquo;Apply to line prices&rdquo; in the
                  recap again.
                </p>
              )}
              <div className="mt-2 overflow-x-auto rounded-md border border-line-row">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="text-ink-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium"><span className="sr-only">Update</span></th>
                      <th className="px-3 py-2 font-medium">Line</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Cost</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">Effect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-row">
                    {plan.updates.map((u) => (
                      <tr key={u.lineId} className="text-ink-label">
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Update ${u.description}`}
                            checked={ticked.has(u.lineId)}
                            onChange={(event) => {
                              const next = new Set(ticked);
                              if (event.target.checked) next.add(u.lineId);
                              else next.delete(u.lineId);
                              setTicked(next);
                            }}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-1.5">{u.description}</td>
                        <td className="px-3 py-1.5 tabular-nums">
                          {u.quantity}
                          {u.unit ? ` ${u.unit}` : ""}
                        </td>
                        <td className="px-3 py-1.5"><Move figure={u.cost} /></td>
                        <td className="px-3 py-1.5"><Move figure={u.price} /></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {u.price ? `price ${signed(u.priceEffect)}` : ""}
                          {u.price && u.cost ? " · " : ""}
                          {u.cost ? `cost ${signed(u.costEffect)}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm text-ink-label" data-testid="update-prices-total">
                {chosen.length} of {plan.updates.length} line{plan.updates.length === 1 ? "" : "s"} ticked:{" "}
                {plan.priceHeldForRecap ? "" : `bid ${signed(priceEffect)} (${money(plan.bidBefore)} now), `}
                cost {signed(costEffect)}.
              </p>
            </>
          )}

          {plan.kept.length > 0 && (
            <details className="mt-3 text-xs text-ink-body">
              <summary className="cursor-pointer text-ink-label">
                {plan.kept.length} line{plan.kept.length === 1 ? "" : "s"} left alone
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {plan.kept.map((k) => (
                  <li key={k.lineId}>
                    {k.description} <span className="text-ink-muted">— {KEPT_REASON_TEXT[k.reason]}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {plan.updates.length > 0 && (
              <button
                type="button"
                onClick={apply}
                disabled={isPending || chosen.length === 0}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner />
                    Updating…
                  </span>
                ) : (
                  `Update ${chosen.length} line${chosen.length === 1 ? "" : "s"}`
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={isPending}
              className="text-xs text-ink-body hover:text-ink-label"
            >
              {plan.updates.length > 0 ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
