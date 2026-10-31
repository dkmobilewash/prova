import { createLineItemCatalogEntry } from "@/lib/actions";
import { CatalogEntryRow } from "@/components/CatalogEntryRow";
import { TRADE_SCOPE_OPTIONS, tradeScopeLabel } from "@/lib/trade-scopes";
import { COST_CATEGORY_LABEL, COST_CATEGORY_ORDER } from "@/components/costCategoryLabels";
import { money } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";
import { ActionForm } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import type { Prisma } from "@prova/db";

/**
 * THE PRICE BOOK'S OWN PIECES — the add form, the column header and one entry's
 * row — shared by the CRM's `/catalog` and C Stream Bid's price book.
 *
 * Moved out of `app/(app)/catalog/page.tsx` without being rewritten (the
 * comments are the page's own). The page keeps what only the CRM has: the
 * actuals-against-budget line and the vendor-quote line under each entry
 * (`ActualsLine`, `QuoteLine` — job costing and vendor pricing, both past the
 * bid), which it hands `CatalogEntryItem` as `children`. Bid renders the same
 * item with none, so a price set here is the price the CRM shows.
 */

/** desc · unit · price · cost · trade — the WHOLE grid (columns and gap),
 *  shared by the header and each row so the columns line up. The gap lives
 *  here too: when only the rows carried `gap-x-3`, the header's fixed
 *  columns packed 2-3rem to the right of their values and "Cost" ran into
 *  "Trade". Callers add only `grid`/`hidden sm:grid`. A phone gets
 *  description and price. Literal so Tailwind sees every class. */
export const CATALOG_ROW_GRID =
  "gap-x-4 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_9rem]";

type CraftOption = { id: string; name: string; unionLocal: { parentInternational: string; localNumber: string } };

/** The add-an-entry form (the body of the page's collapsed "Add a catalog entry"). */
export function CatalogEntryAddForm({ craftClassifications }: { craftClassifications: readonly CraftOption[] }) {
  return (
  <div className="rounded-xl border border-line-card bg-surface p-4">
    <h2 className="mb-3 text-sm font-semibold text-ink-label">Add a catalog entry</h2>
    <ActionForm action={createLineItemCatalogEntry} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-ink-label">
        Description
        <input
          name="description"
          required
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Unit
        <input
          name="unit"
          placeholder="e.g. sq ft"
          className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
      </label>
      {/* THESE THREE HAD NO `type` AT ALL, so they defaulted to text and
          fed `nullableDecimalFromForm`, which refused anything `Number()`
          could not read. Type "1,200" or "$2.85" — the two ways a person
          actually writes a price — and the action THREW, which on this
          form was the worst case in the app: a plain `<form action={…}>`
          with no client error handling, so the throw reached the error
          boundary, the page was replaced, and every field typed alongside
          it went with it. The message would have been redacted anyway.
    
          THE FIX THAT USED TO BE DESCRIBED HERE WAS `type="number"`, and
          this paragraph recommended it in as many words: "makes the
          browser refuse the comma and the dollar sign before anything is
          submitted". That sentence is true and it is the PROBLEM, not the
          solution — measured in real Chromium 2026-09-21, setting such a
          field's value to `2,800` submits an EMPTY STRING, and on a
          NULLABLE field like these three an empty string is "not set", so
          the price silently vanished with no error at all. Firefox
          submits "" for anything it dislikes. Refusing input at the box
          is only safe when the box refuses visibly, and it does not.
    
          So: `type="text"` with `inputMode="decimal"` — what was typed
          stays on screen and a phone still opens on a keypad — and the
          server does the deciding, tolerantly, in lib/numeric-input.ts.
          `1,200` and `$2.85` both save now. `step` went with the type;
          there is nothing left for it to fix.
    
          `createLineItemCatalogEntry` returns its refusals rather than
          throwing them, and this form posts through `<ActionForm>`, so a
          figure that genuinely is not a number arrives as a sentence
          under the fields that are still filled in. */}
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Default unit price
        <input
          name="defaultUnitPrice"
          type="text"
          inputMode="decimal"
          placeholder="optional"
          className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Default budgeted cost
        <input
          name="defaultBudgetedUnitCost"
          type="text"
          inputMode="decimal"
          placeholder="optional"
          className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
      </label>
      {/* The label states the ARITHMETIC, not the units, because the
          arithmetic is what nobody could tell. `addCatalogLine` copies this
          value onto the new line as-is while unit price and budgeted cost
          are both multiplied by quantity downstream — so a 6 SF line and a
          600 SF line built from this entry carry identical hours.
    
          That open question is ANSWERED as of #514, and the answer was
          "both, in two columns": this field stays flat and the Rate field
          below it carries the per-unit reading, so an estimator picks the
          one they mean instead of the app picking for them. The import asks
          the same question about a file's Hours column. */}
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Default labor hrs — whole line
        <input
          name="defaultLaborHours"
          type="text"
          inputMode="decimal"
          placeholder="optional"
          aria-describedby="defaultLaborHours-help"
          className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <span id="defaultLaborHours-help" className="max-w-[14rem] text-xs text-ink-body">
          Copied onto the line unchanged — a 6 SF line and a 600 SF line both
          get this many hours. Not a per-unit rate.
        </span>
      </label>
      {/* The per-unit half of the pair, #514. Same label as the estimate
          line's own field (`LaborHoursField`) on purpose: it is the same
          number, and two names for it is how the flat-vs-per-unit confusion
          this screen already carries a scar for started.
    
          The help text states the PRECEDENCE, because that is the part a
          filled-in rate can silently lose to. `estimatedHours()` takes the
          flat hours as the override, so an entry carrying both produces a
          line whose rate never divides anything — and nothing else on the
          row would say so. */}
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Rate (units/hr)
        <input
          name="productionRate"
          type="text"
          inputMode="decimal"
          placeholder="62.5"
          aria-describedby="productionRate-help"
          className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <span id="productionRate-help" className="max-w-[14rem] text-xs text-ink-body">
          How fast the crew works — hours become quantity ÷ rate, so this one
          does scale. If you fill in both, the whole-line hours above win.
        </span>
      </label>
      {/* #513. The bid recap marks up BY cost type, and until now nothing
          automated set it — so every line generated from this entry landed
          uncoded and was carried into the bid at direct cost, earning no
          markup at all. Set here once per item rather than re-coded on
          every bid, which is the whole argument for a price book. */}
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Cost type
        <select
          name="costCategory"
          defaultValue=""
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        >
          <option value="">No cost type</option>
          {COST_CATEGORY_ORDER.map((value) => (
            <option key={value} value={value}>
              {COST_CATEGORY_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Trade
        <select
          name="tradeScope"
          defaultValue=""
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        >
          <option value="">No trade tag</option>
          {TRADE_SCOPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {craftClassifications.length > 0 && (
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Craft
          <select
            name="craftClassificationId"
            defaultValue=""
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="">No craft tag</option>
            {craftClassifications.map((c) => (
              <option key={c.id} value={c.id}>
                {c.unionLocal.parentInternational} {c.unionLocal.localNumber} — {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <SubmitButton
        type="submit"
        className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
      >
        Add entry
      </SubmitButton>
    </ActionForm>
  </div>
  );
}

/** The column titles above the list (sm and up; a phone gets description and price). */
export function CatalogListHeader() {
  return (
  <div className={`hidden px-4 pb-1 text-xs text-ink-muted sm:grid ${CATALOG_ROW_GRID} sm:pl-9 sm:pr-24`}>
    <span>Description</span>
    <span>Unit</span>
    <span className="text-right">Price</span>
    <span className="text-right">Cost</span>
    <span>Trade</span>
  </div>
  );
}

export type CatalogEntryForItem = Prisma.LineItemCatalogEntryGetPayload<{
  include: { craftClassification: { include: { unionLocal: true } } };
}>;

/**
 * One catalog entry: the closed row (description, unit, price, cost, trade) and
 * the opened detail. `children` render at the bottom of the detail — the CRM
 * puts its actuals and vendor-quote lines there; Bid passes nothing.
 */
export function CatalogEntryItem({
  entry,
  linkedLineCount,
  children,
}: {
  entry: CatalogEntryForItem;
  /** Job lines built from this entry — what a delete would orphan. */
  linkedLineCount: number;
  children?: React.ReactNode;
}) {
  return (
      <CatalogEntryRow
                entryId={entry.id}
        linkedLineCount={linkedLineCount}
      >
        <Disclosure
          variant="row"
          name="catalog-entry"
          summary={
            <span className={`grid min-w-0 flex-1 ${CATALOG_ROW_GRID}`}>
              <span className="truncate font-medium text-ink">{entry.description}</span>
              <span className="hidden text-ink-body sm:block">{entry.unit ?? "—"}</span>
              <span className="text-right text-ink-body">
                {entry.defaultUnitPrice != null ? money(Number(entry.defaultUnitPrice)) : "—"}
              </span>
              <span className="hidden text-right text-ink-body sm:block">
                {entry.defaultBudgetedUnitCost != null ? money(Number(entry.defaultBudgetedUnitCost)) : "—"}
              </span>
              <span className="hidden truncate text-ink-body sm:block">
                {tradeScopeLabel(entry.tradeScope) ?? "No trade tag"}
              </span>
            </span>
          }
        >
          <p className="text-sm text-ink-body">
            {entry.unit && <>{entry.unit} · </>}
            {entry.defaultUnitPrice != null && <>{money(Number(entry.defaultUnitPrice))}/unit · </>}
            {entry.defaultBudgetedUnitCost != null && (
              <>{money(Number(entry.defaultBudgetedUnitCost))} cost · </>
            )}
            {tradeScopeLabel(entry.tradeScope) ?? "No trade tag"}
            {entry.craftClassification && (
              <>
                {" "}
                · {entry.craftClassification.unionLocal.parentInternational}{" "}
                {entry.craftClassification.unionLocal.localNumber} — {entry.craftClassification.name}
              </>
            )}
            {/* "hrs/line", never a bare "hrs", and deliberately the same
                shape as the "/unit" on the price two lines up. The number
                is copied onto an added line UNCHANGED — see
                `addCatalogLine` and `catalog-line.test.ts`. A reader who
                sees "$2.85/unit · 8 hrs" beside each other has no way to
                tell that one of them scales with quantity and the other
                does not, which is exactly how an estimator read it. */}
            {entry.defaultLaborHours != null && (
              <> · {entry.defaultLaborHours.toString()} hrs/line</>
            )}
            {/* "/hr" against the "hrs/line" above, so the two are
                distinguishable at a glance — the whole point of the
                comment on that line. When BOTH are set the rate is
                inert (`estimatedHours()` takes the flat hours), and a
                number printed beside the one that beats it reads as
                being in use, so it says so rather than sitting there
                looking like an assumption the bid was built on. */}
            {/* Named on the row because an entry with no cost type
                produces lines the recap marks up at NOTHING, and that is
                invisible until somebody opens the recap and reads the
                warning. #513. */}
            {entry.costCategory == null ? (
              <> · <span className="text-tag-amber-ink">no cost type — won&apos;t be marked up</span></>
            ) : (
              <> · {COST_CATEGORY_LABEL[entry.costCategory]}</>
            )}
            {entry.productionRate != null && (
              <>
                {" "}
                · {entry.productionRate.toString()}
                {entry.unit ? ` ${entry.unit}` : ""}/hr
                {entry.defaultLaborHours != null && " (unused — hrs/line wins)"}
              </>
            )}
          </p>
          {children}
        </Disclosure>
      </CatalogEntryRow>
  );
}
