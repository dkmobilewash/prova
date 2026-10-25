"use client";

import { useMemo, useOptimistic, useState, useTransition, type FormEvent } from "react";
import { applyBidRecap, saveBidRecap, setLineBudgetedCost, setLineCostCategory } from "@/lib/actions";
import { money } from "@/lib/money";
import { isBlank, parseNumericInput } from "@/lib/numeric-input";
import { asCostCategory, EQUIPMENT_SPLIT_NOTE } from "@/lib/cost-category";
import { bidMargin, formatMarginRate, underCostWarning } from "@/lib/estimating/bid-margin";
import { bidTotalOf } from "@/lib/estimating/recap-state";
import {
  bidRecap,
  COST_CATEGORY_LABELS,
  COST_CATEGORY_VALUES,
  applyPlan,
  spreadTotal,
  RECAP_RATE_FIELDS,
  RECAP_RATE_KEYS,
  type CostCategoryValue,
  type RecapLine,
  type RecapRates,
} from "@/lib/bid-recap";
import { Spinner } from "@/components/Spinner";
import { secondaryActionClass } from "@/components/emptyStateStyles";

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

/**
 * One edit a row has sent and the server has not answered yet.
 *
 * ── WHY THE PREVIEW CANNOT JUST WAIT FOR THE SERVER — bug A, 2026-10-19 ──
 *
 * It did, and on a slow server it showed $0.00 until a reload. Nothing was
 * missing a revalidation: Next runs Server Actions one at a time in a queue,
 * every one of these saves is an async transition, and React 19 commits NONE of
 * their re-renders until the last one in the batch settles. Measured in a real
 * Chromium against a production build with 2s of latency per request: four
 * cost boxes typed in a row, four POSTs strictly one after another, and the
 * direct cost read $0.00 for 8.2 seconds and then jumped to the full figure,
 * with nothing in between. On the real Estimate tab each of those round trips
 * is a whole page render.
 *
 * The rates were always immediate because the preview reads them from the
 * form's own `draft`. The lines now get the same treatment: `useOptimistic`
 * lays each sent edit over the server's lines, the preview runs the SAME pure
 * `bidRecap` over the result, and the server's lines take over the moment its
 * re-render commits. A refused save drops its edit at the end of its
 * transition, so the old figure comes back beside the refusal.
 *
 * Nothing about the arithmetic moves. This only decides WHICH lines the
 * existing preview is computed from.
 */
type LineEdit =
  | { id: string; field: "unitCost"; value: number | null }
  | { id: string; field: "costCategory"; value: CostCategoryValue | null };

function withEdit(lines: RecapLineView[], edit: LineEdit): RecapLineView[] {
  return lines.map((line) => (line.id === edit.id ? { ...line, [edit.field]: edit.value } : line));
}

/**
 * What the server will store for a typed cost, or `undefined` when it will
 * refuse it.
 *
 * The SAME parser `setLineBudgetedCost` reads with (`nullableDecimalFromForm`
 * is `parseNumericInput` with a blank-means-null check in front), with the same
 * floor, so the figure previewed is the figure that gets saved. `undefined`
 * shows nothing optimistic at all: the save is sent anyway and its refusal is
 * what the row prints — a preview of a number the server is about to reject
 * would be the one thing worse than no preview.
 */
function previewCost(raw: string): number | null | undefined {
  if (isBlank(raw)) return null;
  const parsed = parseNumericInput(raw, { label: "Budgeted cost", min: 0 });
  return parsed.ok ? parsed.n : undefined;
}

const field =
  "w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

export function BidRecapPanel({
  jobId,
  lines,
  rates,
  applied,
  ratesCollapsed = false,
}: {
  jobId: string;
  lines: RecapLineView[];
  rates: RecapRates;
  applied: { at: string; total: number } | null;
  /** Presentational: start with the rates form behind an "Edit rates"
   * button (declutter round 2). The draft rates live in state above, so the
   * preview below is the same whether the form is shown or not. */
  ratesCollapsed?: boolean;
}) {
  const [ratesShown, setRatesShown] = useState(!ratesCollapsed);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(RATE_FIELDS.map((f) => [f.key, rates[f.key] != null ? String(rates[f.key]) : ""])),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [confirmingPrice, setConfirmingPrice] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isApplying, startApply] = useTransition();
  // The server's lines with every unanswered edit laid over them — see
  // `LineEdit`. Everything below reads THESE, never `lines` directly, so the
  // figures and the rows that edit them cannot disagree.
  const [shownLines, showEdit] = useOptimistic(lines, withEdit);
  const saving = shownLines !== lines;

  const preview = useMemo(() => {
    const parsed: RecapRates = Object.fromEntries(
      RATE_FIELDS.map((f) => {
        const raw = draft[f.key]?.trim();
        const value = raw ? Number(raw) : null;
        return [f.key, value != null && Number.isFinite(value) ? value : null];
      }),
    );
    const recap = bidRecap(shownLines, parsed);
    // What Apply would do — the SAME `applyPlan` the server runs on press.
    const plan = applyPlan(shownLines, recap.bidTotal);
    const spread = plan.kind === "NOTHING" ? [] : plan.spread;
    // The margin is of the LINE PRICES, so it does not depend on the draft
    // rates at all — but it lives in this memo because it is derived from the
    // same `lines` and nothing should recompute it on a keystroke.
    return {
      recap,
      landsAt: spread.length > 0 ? spreadTotal(shownLines, spread) : recap.bidTotal,
      margin: bidMargin(shownLines),
      // Bug B: why Apply would write nothing, said BEFORE it is pressed.
      plan,
      nothing: plan.kind === "NOTHING" ? plan.reason : null,
      // Bug C: the bid of record — what the job header and the proposal print —
      // from the one function they read. See the row that renders it.
      bidOnJob: bidTotalOf(shownLines),
    };
  }, [draft, shownLines]);

  const { recap, landsAt, margin, plan, nothing, bidOnJob } = preview;
  // Step one of the two-step confirmation. Only meaningful while the plan is
  // still "price the unpriced lines": if an edit changes the plan, the confirm
  // goes away with it rather than confirming a different action.
  const confirming = confirmingPrice && plan.kind === "PRICE_UNPRICED";
  const descriptionOf = (id: string) => shownLines.find((l) => l.id === id)?.description ?? "a line";
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
      {!ratesShown && (
        <button
          type="button"
          onClick={() => setRatesShown(true)}
          className={`${secondaryActionClass} self-start`}
        >
          Edit rates
        </button>
      )}
      {ratesShown && (
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
            className="rounded-md bg-rail-hover px-4 py-2 text-sm font-medium text-ink hover:bg-lift disabled:opacity-50"
          >
            {isSaving ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner />
                Saving…
              </span>
            ) : (
              "Save rates"
            )}
          </button>
          {saveError && <p className="text-sm text-tag-amber-ink">{saveError}</p>}
        </div>
      </form>
      )}

      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-line-row">
            {/* True by design since #512 rather than by accident: this is the
                sum of quantity × budgetedUnitCost, the cost of doing the work.
                Before #512 the same words sat over a sum of SALE PRICES. */}
            <td className="py-1 text-ink-label">
              Direct cost of the work
              {/* The figure beside this already counts every cost typed, and
                  the saves behind it run one at a time — four boxes can take
                  four page renders to land. So it says it is still saving:
                  a figure that looks final while three saves are queued is
                  how somebody reloads and loses them. `useOptimistic` hands
                  back the server's own array once nothing is pending. */}
              {saving && (
                <span role="status" className="ml-2 inline-flex items-center gap-1 text-xs text-ink-muted">
                  <Spinner />
                  Saving…
                </span>
              )}
            </td>
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
          {/* BUG C, 2026-10-19: the header said BID $0.00 directly above a
              recap that said $10,249.47, and neither was wrong. The header is
              the bid OF RECORD — the line prices, which the proposal prints and
              the contract value becomes — and the total above is what those
              prices would be once applied. Two true numbers, one word, and
              nothing on screen saying which was which.

              So the recap shows the header's figure too, read through the SAME
              `bidTotalOf` that `loadJobSummary` now uses — not a third sum of
              quantity × price — whenever applying would change it. Once Apply
              has written the prices the two agree and this row goes away; on a
              priced job with no costs it is the row that explains a $0 recap
              under a real bid. */}
          {Math.round(bidOnJob * 100) !== Math.round(landsAt * 100) && (
            <tr>
              <td className="pb-2 text-ink-label">
                Bid on the job now
                <span className="block text-xs text-ink-muted">
                  The line prices — what the job header and the proposal show.
                  {nothing ? "" : ` Apply to line prices to make it ${money(landsAt)}.`}
                </span>
              </td>
              <td className="pb-2 text-right align-top tabular-nums text-ink-body">{money(bidOnJob)}</td>
            </tr>
          )}
          {/* A ROW, NOT A FOURTH NOTICE. This panel already carries three and
              its own rule is that "a permanent notice is noise that teaches
              people to stop reading notices" — so the margin is a figure under
              the total, and only the under-cost case says a sentence (below).

              It is the margin of the LINE PRICES against the line costs, not of
              the bid total above: `bidTotal` is derived as cost plus rates
              bounded 0-100, so a margin taken from it is positive by
              construction and could never report anything. `bid-margin.ts` has
              the argument and a test pins it. */}
          <tr className="border-t border-line-row">
            <td className="py-2 text-ink-label">
              Margin on the line prices
              {margin.state === "COVERED" || margin.state === "UNDER_COST" ? (
                <span className="ml-2 text-xs text-ink-muted">{money(margin.priced)} priced</span>
              ) : null}
            </td>
            <td
              className={`py-2 text-right tabular-nums ${
                margin.state === "UNDER_COST" ? "font-semibold text-tag-rose-ink" : "text-ink-body"
              }`}
            >
              {margin.state === "NO_PRICES"
                ? "no priced lines"
                : margin.state === "NO_COSTS"
                  ? "no costs recorded"
                  : formatMarginRate(margin.rate)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* THE WARNING, and the only state that gets a sentence. Amber is for the
          two fixable problems below; this one is rose, because a bid that does
          not cover its cost is not a field somebody forgot to fill in. */}
      {underCostWarning(margin, money) && (
        <p className="text-sm text-tag-rose-ink">{underCostWarning(margin, money)}</p>
      )}

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
          {confirming && (
            // Cancel takes the FIRST slot: this cluster is left-aligned, so the
            // first slot is the one Apply just vacated, and a hurried second
            // click lands on Cancel rather than on the write.
            <button
              type="button"
              disabled={isApplying}
              onClick={() => setConfirmingPrice(false)}
              className={secondaryActionClass}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={isApplying || recap.addedTotal === 0 || nothing !== null}
            title="Raises each line's unit price so the estimate's lines add up to the bid. Do this once the price is settled."
            onClick={() => {
              // Step one of two when no line has a price: show what will be
              // written and wait. Never silent.
              if (plan.kind === "PRICE_UNPRICED" && !confirming) {
                setApplyMessage(null);
                setConfirmingPrice(true);
                return;
              }
              startApply(async () => {
                setApplyMessage(null);
                const result = await applyBidRecap(jobId, confirming ? { priceUnpriced: true } : {});
                setConfirmingPrice(false);
                setApplyMessage(
                  result.ok
                    ? `Applied to ${result.value.lineCount} line${result.value.lineCount === 1 ? "" : "s"} — they now total ${money(result.value.appliedTotal)}.`
                    : result.error,
                );
              });
            }}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApplying
              ? "Applying…"
              : confirming
                ? `Confirm — price ${plan.kind === "PRICE_UNPRICED" ? plan.spread.length : 0} line${plan.kind === "PRICE_UNPRICED" && plan.spread.length === 1 ? "" : "s"}`
                : "Apply to line prices"}
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
        {/* BUG B, 2026-10-19: on an estimate whose lines are all cost-only,
            Apply was enabled, pressing it wrote nothing, and the walk read that
            as silence. The reason is now on screen BEFORE the press, beside a
            button that is disabled for it — the same sentence `applyBidRecap`
            returns, from the same `nothingToSpread`. Amber, like the other two
            things on this panel a person can fix from here. Only when there is
            a markup to apply: with no rates the button is already disabled and
            the sentence would be about nothing. */}
        {recap.addedTotal !== 0 && nothing && <p className="text-sm text-tag-amber-ink">{nothing}</p>}
        {/* NO LINE HAS A PRICE: Apply offers to price the lines that have a
            cost, and says exactly what that writes before anyone confirms. */}
        {confirming && plan.kind === "PRICE_UNPRICED" && (
          <div role="alert" className="text-sm text-ink-body">
            <p>
              This sets a price on {plan.spread.length} line{plan.spread.length === 1 ? "" : "s"} that{" "}
              {plan.spread.length === 1 ? "has" : "have"} none, totalling {money(landsAt)}. Lines you&apos;ve priced by hand:
              none.
            </p>
            {plan.leftUnpriced.length > 0 && (
              <p className="mt-1">
                {plan.leftUnpriced.length} line{plan.leftUnpriced.length === 1 ? " has" : "s have"} no cost, so{" "}
                {plan.leftUnpriced.length === 1 ? "it stays" : "they stay"} unpriced:{" "}
                {plan.leftUnpriced.map((l) => descriptionOf(l.id)).join(", ")}.
              </p>
            )}
          </div>
        )}
        {!confirming && plan.kind === "PRICE_UNPRICED" && recap.addedTotal !== 0 && (
          <p className="text-xs text-ink-muted">
            No line has a unit price yet. Apply will show you the {plan.spread.length} line
            {plan.spread.length === 1 ? "" : "s"} it would price and ask you to confirm.
          </p>
        )}
        {!confirming && plan.kind === "PRICED" &&plan.costOnlyLeftAlone > 0 && (
          <p className="text-xs text-ink-muted">
            {plan.costOnlyLeftAlone} cost-only line{plan.costOnlyLeftAlone === 1 ? " is" : "s are"} left alone — Apply
            re-prices only the lines that already carry a price.
          </p>
        )}
        {applyMessage && <p className="text-sm text-ink-body">{applyMessage}</p>}
      </div>

      <div className="border-t border-line-row pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Cost and cost type per line</p>
        <ul className="flex flex-col gap-1">
          {shownLines.map((line) => (
            <CostTypeRow key={line.id} jobId={jobId} line={line} onEdit={showEdit} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CostTypeRow({
  jobId,
  line,
  onEdit,
}: {
  jobId: string;
  line: RecapLineView;
  /** Lays the edit over the panel's preview for as long as its save is in
   * flight. Called INSIDE the transition, which is what `useOptimistic`
   * requires and what ties the edit's lifetime to the save's. */
  onEdit: (edit: LineEdit) => void;
}) {
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
            const shown = previewCost(next);
            startTransition(async () => {
              if (shown !== undefined) onEdit({ id: line.id, field: "unitCost", value: shown });
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
            // "" is the select's own "No cost type"; anything else narrows
            // against the one list, and a value it does not know is left to
            // the server to refuse rather than previewed as a clear.
            const category = next === "" ? null : asCostCategory(next);
            if (next === "" || category !== null) onEdit({ id: line.id, field: "costCategory", value: category });
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
