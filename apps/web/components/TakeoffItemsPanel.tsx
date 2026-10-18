"use client";

import { useMemo, useState, useTransition } from "react";

import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Spinner } from "@/components/Spinner";
import {
  assignMeasurementsToItem,
  createTakeoffItem,
  deleteTakeoffItem,
  duplicateTakeoffItem,
  reorderTakeoffItems,
} from "@/lib/actions";
import { ITEM_COLORS } from "@/lib/takeoff/itemColors";
import {
  type TakeoffItemRow,
  formatQuantity,
  itemQuantity,
  itemQuantityOnPage,
} from "@/lib/takeoff/itemQuantities";

/**
 * ── THE ITEMS RAIL: what is being taken off, and how much of it ──
 *
 * An item is the thing every estimating tool is built around — a named,
 * coloured condition that owns measurements across every sheet in the set.
 * This is the list of them, and the control for drawing with one.
 *
 * ── THE QUANTITIES ARE COMPUTED HERE, EVERY RENDER ──
 *
 * `itemQuantity` runs over the item's measurements on each pass. Nothing is
 * stored and nothing is memoised across a save, which is deliberate: a stored
 * total is a number that was true against a scale somebody may since have
 * corrected, and this is the screen where they correct it. The arithmetic is
 * tested in `lib/takeoff/itemQuantities.test.ts` rather than here.
 *
 * ── SELECTING AN ITEM IS WHAT MAKES A TOOL MEAN ANYTHING ──
 *
 * Every measurement drawn while an item is selected belongs to it. With none
 * selected the tools still work and the geometry lands in "Unassigned", which
 * is recoverable — but the rail says so rather than letting somebody trace a
 * floor's worth of wall into nothing.
 */

type Props = {
  jobId: string;
  items: readonly TakeoffItemRow[];
  /** Which item new measurements belong to, or null for Unassigned. */
  activeItemId: string | null;
  onPick: (itemId: string | null) => void;
  /** The sheet on screen, so each row can show its share as well as the total. */
  currentPage: number;
  /** Items the viewer has hidden. Per-viewer, so it lives above this. */
  hidden: ReadonlySet<string>;
  onToggleHidden: (itemId: string) => void;
  /**
   * The measurements on the CURRENT SHEET that belong to no item.
   *
   * Ids and not just a count, because the rail offers to move them — see the
   * Unassigned row. Current sheet only: moving a whole project's loose
   * geometry into one condition from a button nobody can see the contents of
   * is not a recovery, it is a second mistake.
   */
  unassignedHere: readonly string[];
  /** How many measurements on the whole job have no item. */
  unassignedCount: number;
  readOnly?: boolean;
};

const TYPES = [
  { value: "LINEAR", label: "Linear", unit: "ft" },
  { value: "AREA", label: "Area", unit: "sq ft" },
  { value: "COUNT", label: "Count", unit: "ea" },
  { value: "SEGMENT", label: "Segment", unit: "ft" },
  { value: "AREA_WITH_PERIMETER", label: "Area + perimeter", unit: "sq ft" },
] as const;

export function TakeoffItemsPanel({
  jobId,
  items,
  activeItemId,
  onPick,
  currentPage,
  hidden,
  onToggleHidden,
  unassignedHere,
  unassignedCount,
  readOnly = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("LINEAR");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.name.toLowerCase().includes(needle));
  }, [items, search]);

  /**
   * The project's totals, by unit.
   *
   * BY UNIT AND NOT ONE NUMBER, because feet and square feet and each do not
   * add together. A single "total" across an estimate's conditions is a figure
   * with no meaning, and printing one would invite somebody to quote it.
   */
  const totals = useMemo(() => {
    const byUnit = new Map<string, number>();
    for (const item of items) {
      const quantity = itemQuantity(item.measurements, item);
      byUnit.set(quantity.unit, (byUnit.get(quantity.unit) ?? 0) + quantity.primary);
    }
    return [...byUnit.entries()].filter(([, n]) => n > 0);
  }, [items]);

  const unscaled = useMemo(
    () => items.reduce((n, item) => n + itemQuantity(item.measurements, item).unscaled, 0),
    [items],
  );

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? "That did not work. Reload the page.");
    });
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set("name", name);
    form.set("type", type);
    run(async () => {
      const result = await createTakeoffItem(jobId, form);
      if (result.ok) {
        setName("");
        setAdding(false);
        onPick(result.value.id);
      }
      return result;
    });
  }

  function move(itemId: string, by: -1 | 1) {
    const order = items.map((item) => item.id);
    const at = order.indexOf(itemId);
    const to = at + by;
    if (at === -1 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    run(() => reorderTakeoffItems(jobId, order));
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-takeoff="items-panel">
      <div className="shrink-0 border-b border-line-card p-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Items ({items.length})
          </h2>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setAdding((open) => !open)}
              aria-expanded={adding}
              data-takeoff="add-item"
              className="ml-auto rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-body hover:bg-rail"
            >
              New item
            </button>
          )}
        </div>

        {adding && !readOnly && (
          // Collapsed behind a button, like every other add-form in this app.
          <form onSubmit={add} className="mt-2 flex flex-col gap-1.5" data-takeoff="item-form">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="6in metal stud partition"
              aria-label="Item name"
              name="name"
              className="rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-muted"
            />
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              aria-label="What this item measures"
              name="type"
              className="rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink"
            >
              {TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label} ({entry.unit})
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={pending || name.trim() === ""}
              // `text-neutral-900` on a `bg-brand` fill: `theme-contrast`
              // measures that pair at 11.71:1, and white on this yellow at
              // 1.53:1 — not marginal, unreadable. The census caught
              // `text-tag-brand-ink` here; that token is a TAG ground.
              className="rounded-md border border-line-card bg-brand px-2 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
            >
              {pending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  Adding…
                </span>
              ) : (
                "Add"
              )}
            </button>
          </form>
        )}

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find an item"
          aria-label="Find an item by name"
          data-takeoff="item-search"
          className="mt-2 w-full rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-muted"
        />
      </div>

      {error && (
        <p className="shrink-0 bg-tag-rose px-2 py-1 text-xs text-tag-rose-ink" role="alert" data-takeoff="item-error">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          // A REAL EMPTY STATE WITH A WAY OUT, per this app's list conventions.
          <p className="px-1 py-6 text-center text-xs text-ink-muted" data-takeoff="items-empty">
            Nothing is being taken off yet. Add an item — a wall type, a ceiling, a
            fixture — then draw it on the sheet.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-ink-muted">No item matches that.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {shown.map((item, index) => {
              const total = itemQuantity(item.measurements, item);
              const here = itemQuantityOnPage(item.measurements, item, currentPage);
              const active = item.id === activeItemId;
              return (
                <li key={item.id} data-takeoff="item-row" data-item={item.id}>
                  <div
                    className={
                      "group rounded-md border px-2 py-1.5" +
                      (active ? " border-brand bg-tag-brand-soft" : " border-transparent hover:bg-rail")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => onPick(active ? null : item.id)}
                        aria-pressed={active}
                        data-takeoff="pick-item"
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      >
                        <span
                          aria-hidden
                          className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border border-line-card"
                          style={{ backgroundColor: item.colorHex }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-ink">{item.name}</span>
                          <span className="block text-[11px] text-ink-body" data-takeoff="item-total">
                            {formatQuantity(total)}
                            {here.primary > 0 && (
                              <span className="text-ink-muted"> · {formatQuantity(here)} here</span>
                            )}
                          </span>
                          {total.unscaled > 0 && (
                            <span className="block text-[10px] text-tag-amber-ink">
                              {total.unscaled} measurement{total.unscaled === 1 ? "" : "s"} on a sheet with no
                              scale — not counted
                            </span>
                          )}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleHidden(item.id)}
                        aria-pressed={hidden.has(item.id)}
                        aria-label={hidden.has(item.id) ? `Show ${item.name}` : `Hide ${item.name}`}
                        data-takeoff="toggle-item"
                        className="shrink-0 rounded px-1 text-xs text-ink-muted hover:text-ink-body"
                      >
                        {hidden.has(item.id) ? "◌" : "●"}
                      </button>
                    </div>

                    {/* ── `RowActions`, NOT A BARE FLEX ROW ──
                          Issue #152's rule 1: while a delete is armed EVERY
                          ordinary action goes, not just the one somebody
                          remembered. Reorder and Copy sitting live beside an
                          armed confirm is how a hurried second click costs a
                          record. `RowActions` hides its children for exactly
                          that, and `ConfirmDelete` handles the geometry —
                          including the column it becomes below `sm`, so the
                          confirm never lands on the delete's pixel.
                          The first version of this row put ConfirmDelete in a
                          plain div and the census caught it. */}
                    {!readOnly && (
                      <RowActions
                        className="mt-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                        destructive={
                          <ConfirmDelete
                            label="Delete"
                            describe={`Delete the item ${item.name}`}
                            onConfirm={() => run(() => deleteTakeoffItem(jobId, item.id))}
                            hint={
                              item.measurements.length > 0
                                ? `${item.measurements.length} measurement${
                                    item.measurements.length === 1 ? "" : "s"
                                  } will move to Unassigned, not be deleted.`
                                : undefined
                            }
                          />
                        }
                      >
                        <button
                          type="button"
                          onClick={() => move(item.id, -1)}
                          disabled={index === 0 || pending}
                          aria-label={`Move ${item.name} up`}
                          className="rounded border border-line-card px-1 text-[10px] text-ink-muted disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => move(item.id, 1)}
                          disabled={index === shown.length - 1 || pending}
                          aria-label={`Move ${item.name} down`}
                          className="rounded border border-line-card px-1 text-[10px] text-ink-muted disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => run(() => duplicateTakeoffItem(jobId, item.id))}
                          disabled={pending}
                          data-takeoff="duplicate-item"
                          className="rounded border border-line-card px-1 text-[10px] text-ink-muted"
                        >
                          Copy
                        </button>
                      </RowActions>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {unassignedCount > 0 && (
          <div
            className={
              "mt-2 rounded-md border px-2 py-1.5" +
              (activeItemId === null ? " border-brand bg-tag-brand-soft" : " border-line-card")
            }
            data-takeoff="unassigned"
          >
            <button
              type="button"
              onClick={() => onPick(null)}
              aria-pressed={activeItemId === null}
              className="w-full text-left text-xs text-ink-body"
            >
              Unassigned
              <span className="ml-1 text-ink-muted">
                {unassignedCount} measurement{unassignedCount === 1 ? "" : "s"}
              </span>
            </button>

            {/* ── AND THE WAY BACK OUT ──
                Deleting an item keeps its geometry and drops it here, which
                this app promises in as many words. A promise with no control
                behind it is a lie, so here is the control: everything loose on
                THIS sheet, into one item, in a press. */}
            {!readOnly && unassignedHere.length > 0 && items.length > 0 && (
              <label className="mt-1 flex items-center gap-1 text-[11px] text-ink-muted">
                Move {unassignedHere.length} on this sheet to
                <select
                  value=""
                  disabled={pending}
                  data-takeoff="assign-unassigned"
                  onChange={(event) => {
                    const itemId = event.target.value;
                    if (!itemId) return;
                    run(() => assignMeasurementsToItem(jobId, itemId, [...unassignedHere]));
                  }}
                  className="min-w-0 flex-1 rounded border border-line-card bg-surface px-1 py-0.5 text-[11px] text-ink"
                >
                  <option value="">pick an item…</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line-card px-2 py-1.5" data-takeoff="project-totals">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Whole project</h3>
        {totals.length === 0 ? (
          <p className="text-[11px] text-ink-muted">Nothing measured yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 text-[11px] text-ink-body">
            {totals.map(([unit, n]) => (
              <li key={unit}>
                <span className="font-semibold text-ink">
                  {n.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                </span>{" "}
                {unit}
              </li>
            ))}
          </ul>
        )}
        {unscaled > 0 && (
          <p className="mt-0.5 text-[10px] text-tag-amber-ink">
            {unscaled} measurement{unscaled === 1 ? "" : "s"} on sheets with no scale are not in these totals.
          </p>
        )}
      </div>
    </div>
  );
}

export { TYPES as TAKEOFF_ITEM_TYPES, ITEM_COLORS };
