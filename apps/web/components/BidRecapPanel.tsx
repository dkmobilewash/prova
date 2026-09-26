"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { applyBidRecap, saveBidRecap, setLineBudgetedCost, setLineCostCategory } from "@/lib/actions";
import { money } from "@/lib/money";
import { EQUIPMENT_SPLIT_NOTE } from "@/lib/cost-category";
import {
  bidRecap,
  COST_CATEGORY_LABELS,
  COST_CATEGORY_VALUES,
  spreadToLines,
  spreadTotal,
  RECAP_RATE_FIELDS,
  RECAP_RATE_KEYS,
  type CostCategoryValue,
  type RecapLine,
  type RecapRates,
} from "@/lib/bid-recap";

/**
 * The bid recap on the Estimate tab: what the work costs, what it is sold for,
 * and the steps between.
 *
 * The preview runs the SAME pure `bidRecap` the server runs on apply, so the
 * total on screen before applying is the total that gets written — a preview
 * that disagrees with what it commits is worse than none (the rule
 * `TakeoffForm` and `WallSchedule` already follow).
 */

/**
 * Every rate the form offers, keyed by the rate it writes.
 *
 * A TOTAL `Record` over `keyof RecapRates`, not an array, and the difference is
 * a whole capability: an array can be missing a rate, and a rate with no input
 * on this form is one NOBODY CAN EVER SET — the server parses it, the schema
 * stores it, and it stays null forever with nothing on screen to say why. That
 * is the far side of the same drift that produced a NaN bid total: there, a
 * category the math did not know about; here, a rate the form does not offer.
 * This does not compile until every rate has a field.
 *
 * Declaration order is the order they render, which matches the order they
 * apply in `bidRecap`.
 */
const RATE_FIELDS = RECAP_RATE_KEYS.map((key) => ({ key, ...RECAP_RATE_FIELDS[key] }));

export type RecapLineView = RecapLine & { description: string };

const field =
  "w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

export function BidRecapPanel({
  jobId,
  lines,
  rates,
  applied,
}: {
  jobId: string;
  lines: RecapLineView[];
  rates: RecapRates;
  applied: { at: string; total: number } | null;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(RATE_FIELDS.map((f) => [f.key, rates[f.key] != null ? String(rates[f.key]) : ""])),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isApplying, startApply] = useTransition();

  const preview = useMemo(() => {
    const parsed: RecapRates = Object.fromEntries(
      RATE_FIELDS.map((f) => {
        const raw = draft[f.key]?.trim();
        const value = raw ? Number(raw) : null;
        return [f.key, value != null && Number.isFinite(value) ? value : null];
      }),
    );
    const recap = bidRecap(lines, parsed);
    const spread = spreadToLines(lines, recap.bidTotal);
    return { recap, landsAt: spread.length > 0 ? spreadTotal(lines, spread) : recap.bidTotal };
  }, [draft, lines]);

  const { recap, landsAt } = preview;
  const roundingGap = Math.round((landsAt - recap.bidTotal) * 100) / 100;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSaveError(null);
    startSave(async () => {
      const result = await saveBidRecap(jobId, formData);
      if (!result.ok) setSaveError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line-card bg-surface p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {RATE_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs text-ink-label" title={f.hint}>
              {f.label}
              <span className="flex w-fit items-center gap-1">
                <input
                  name={f.key}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="—"
                  className={field}
                />
                <span className="text-ink-muted">%</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save rates"}
          </button>
          {saveError && <p className="text-sm text-tag-amber-ink">{saveError}</p>}
        </div>
      </form>

      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-line-row">
            {/* True by design since #512 rather than by accident: this is the
                sum of quantity × budgetedUnitCost, the cost of doing the work.
                Before #512 the same words sat over a sum of SALE PRICES. */}
            <td className="py-1 text-ink-label">Direct cost of the work</td>
            <td className="py-1 text-right tabular-nums text-ink">{money(recap.direct.total)}</td>
          </tr>
          {recap.steps.map((step) => (
            <tr key={step.key} className="border-b border-line-row">
              <td className="py-1 text-ink-body">
                {step.label}
                {step.ratePercent != null && <span className="ml-1 text-ink-muted">{step.ratePercent}%</span>}
              </td>
              <td className="py-1 text-right tabular-nums text-ink-body">+{money(step.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-medium text-ink">Bid total</td>
            <td className="py-2 text-right font-semibold tabular-nums text-ink">{money(recap.bidTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* #512. Rendered BEFORE the no-cost-type warning because it is the more
          fundamental one: a line with no cost is missing the figure this whole
          panel marks up, and on a job built through the bid wizard — which
          collects no cost at all — it is every line, so the direct cost above
          reads $0. Saying "no cost type" first would name the smaller problem.

          Never filled in from the sale price. That fallback is the double-markup
          this change removes, kept alive for exactly the lines most likely to
          hit it. */}
      {recap.direct.pricedWithNoCostLineCount > 0 && (
        <p className="text-sm text-tag-amber-ink">
          {recap.direct.pricedWithNoCostLineCount} line
          {recap.direct.pricedWithNoCostLineCount === 1 ? " carries" : "s carry"} a price but no cost
          {recap.direct.pricedWithNoCost > 0 ? ` (${money(recap.direct.pricedWithNoCost)} of price)` : ""} — not in the
          direct cost above, and not marked up.
          {recap.direct.total === 0
            ? " This bid has no cost base at all: set a budgeted cost on each line below, or the bid is $0."
            : " Applying will leave those prices unchanged."}
        </p>
      )}

      {recap.direct.uncategorisedLineCount > 0 && (
        <p className="text-sm text-tag-amber-ink">
          {recap.direct.uncategorisedLineCount} line
          {recap.direct.uncategorisedLineCount === 1 ? " has" : "s have"} no cost type
          {recap.direct.uncategorised > 0 ? ` (${money(recap.direct.uncategorised)})` : ""} — marked up at nothing. Set
          the type on each line below.
        </p>
      )}

      {/* LAST of the three notices, and muted rather than amber, because it is
          not a problem with this estimate — it is a fact about what the
          equipment figure can and cannot include. The two above are things the
          reader can fix on this screen; this one nobody can. Shown only when an
          equipment or other figure is actually present: a permanent notice is
          noise that teaches people to stop reading notices. */}
      {(recap.direct.byCategory.EQUIPMENT > 0 || recap.direct.byCategory.OTHER > 0) && (
        <p className="text-xs text-ink-muted">{EQUIPMENT_SPLIT_NOTE}</p>
      )}

      <div className="flex flex-col gap-2 border-t border-line-row pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isApplying || recap.addedTotal === 0}
            title="Raises each line's unit price so the estimate's lines add up to the bid. Do this once the price is settled."
            onClick={() =>
              startApply(async () => {
                setApplyMessage(null);
                const result = await applyBidRecap(jobId);
                setApplyMessage(
                  result.ok
                    ? `Applied to ${result.value.lineCount} line${result.value.lineCount === 1 ? "" : "s"} — they now total ${money(result.value.appliedTotal)}.`
                    : result.error,
                );
              })
            }
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApplying ? "Applying…" : "Apply to line prices"}
          </button>
          {roundingGap !== 0 && recap.addedTotal !== 0 && (
            <p className="text-xs text-ink-muted">
              Applying lands at {money(landsAt)} — {money(Math.abs(roundingGap))}{" "}
              {roundingGap < 0 ? "under" : "over"} the bid, because a unit price holds two decimals.
            </p>
          )}
        </div>
        {/* THIS SENTENCE SAID THE OPPOSITE AND HAD TO CHANGE — #512.
            It read "Applying again marks the current prices up a second time",
            which was true and was the ONLY brake on it: `applyBidRecap` never
            checks `appliedAt`.

            It cannot compound any more. The bid is built from
            `budgetedUnitCost` and applying writes `unitPrice`, so the input to
            the calculation is no longer the output of the last one — pressing
            twice writes the same prices. Pinned by an action test that used to
            assert the compounding.

            Left as a statement of what it DOES rather than deleted: an
            estimator who was told once that a second press doubles the markup
            needs to be told it no longer does, or the old warning survives in
            the only place that matters. */}
        {applied && (
          <p className="text-xs text-ink-muted">
            Last applied {applied.at} at {money(applied.total)}. Applying again writes the same prices — it is the
            marked-up cost, not a markup on the current price — so a second press is safe.
          </p>
        )}
        {applyMessage && <p className="text-sm text-ink-body">{applyMessage}</p>}
      </div>

      <div className="border-t border-line-row pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Cost and cost type per line</p>
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <CostTypeRow key={line.id} jobId={jobId} line={line} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CostTypeRow({ jobId, line }: { jobId: string; line: RecapLineView }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-ink-body" title={line.description}>
        {line.description}
      </span>
      {/* THE WAY OUT OF THE WARNING ABOVE — #512.
          A line with no cost is reported and marked up at nothing, and on a
          wizard-built job that is every line. Naming the problem and leaving the
          fix on another part of the page is the dead-end empty state CLAUDE.md
          asks us not to ship, so the cost is editable here, beside the cost
          type, in the row that already exists for the other thing a line can be
          missing.

          `onBlur`, not `onChange`: a keystroke-per-write would fire an action
          for "1", "19", "190". It saves when the box is left or Enter is
          pressed, and `defaultValue` rather than `value` keeps the field the
          user's own while they type. */}
      <label className="flex items-center gap-1 text-xs text-ink-muted">
        Cost
        <input
          aria-label={`Budgeted cost for ${line.description}`}
          type="text"
          inputMode="decimal"
          defaultValue={line.unitCost != null ? String(line.unitCost) : ""}
          placeholder="per unit"
          disabled={isPending}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={(event) => {
            const next = event.target.value.trim();
            const before = line.unitCost != null ? String(line.unitCost) : "";
            if (next === before) return;
            setError(null);
            startTransition(async () => {
              const result = await setLineBudgetedCost(jobId, line.id, next);
              if (!result.ok) setError(result.error);
            });
          }}
          className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-right text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
      </label>
      <select
        aria-label={`Cost type for ${line.description}`}
        defaultValue={line.costCategory ?? ""}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value;
          setError(null);
          startTransition(async () => {
            const result = await setLineCostCategory(jobId, line.id, next);
            if (!result.ok) setError(result.error);
          });
        }}
        className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
      >
        <option value="">No cost type</option>
        {COST_CATEGORY_VALUES.map((value: CostCategoryValue) => (
          <option key={value} value={value}>
            {COST_CATEGORY_LABELS[value]}
          </option>
        ))}
      </select>
      {error && <span className="w-full text-right text-xs text-tag-amber-ink">{error}</span>}
    </li>
  );
}
