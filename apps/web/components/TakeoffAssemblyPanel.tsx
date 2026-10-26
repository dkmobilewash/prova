"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { Spinner } from "@/components/Spinner";
import { sendTakeoffItemsToEstimate, setAssemblyLibraryPin, updateTakeoffItem } from "@/lib/actions";
import { itemGeometry } from "@/lib/estimating/takeoff-item-lines";
import {
  WALL_BASIS_LABELS,
  componentRunQuantity,
  type WallComponentBasis,
} from "@/lib/wall-assemblies";
import type { TakeoffItemRow } from "@/lib/takeoff/itemQuantities";

/**
 * ── THE ASSEMBLY, AND WHAT IT COMES TO ──
 *
 * An item is a quantity; an assembly turns it into parts with prices. This
 * shows the company library, lets the selected item point at one, and — the
 * part worth building — prints what EACH PART actually comes to for the
 * quantity on screen.
 *
 * ── THE NUMBERS HERE ARE THE SAME FUNCTION THE ESTIMATE USES ──
 *
 * `itemGeometry` and `componentRunQuantity`, both imported from the modules
 * the server expander calls. Not a second calculation that agrees today: this
 * repo's most expensive recurring defect is a second copy of an arithmetic
 * that drifts, and the last one had Ask reporting a bid $1,732.50 under the
 * Estimate screen.
 *
 * So a part showing 412 sq ft here writes 412 sq ft there, by construction.
 */

type Assembly = {
  id: string;
  code: string;
  name: string;
  defaultHeightFt: number | null;
  sides: number;
  studSpacingIn: number;
  components: {
    id: string;
    description: string;
    unit: string | null;
    basis: string;
    factor: number;
    wastePercent: number;
    roundUp: boolean;
    unitPrice: number | null;
  }[];
};

type Props = {
  jobId: string;
  assemblies: readonly Assembly[];
  item: TakeoffItemRow | null;
  /** ISO date when this job froze its library, or null. */
  pinnedAt: string | null;
  readOnly?: boolean;
  /** Where the wall-type library is — the CRM's page by default, C Stream Bid's
   * own when the workspace is rendered there (`lib/bid/surfaceHrefs.ts`). */
  wallTypesHref?: string;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function TakeoffAssemblyPanel({ jobId, assemblies, item, pinnedAt, readOnly = false, wallTypesHref = "/wall-types" }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const assembly = assemblies.find((entry) => entry.id === item?.wallTypeId) ?? null;

  /**
   * What each part comes to, for the item on screen.
   *
   * Empty when nothing is selected or the item has no assembly — a table of
   * zeros would read as "this assembly produces nothing", which is a very
   * different statement from "no item is selected".
   */
  const parts = useMemo(() => {
    if (!item || !assembly) return [];
    const geometry = itemGeometry({
      id: item.id,
      name: item.name,
      type: item.type,
      heightFt: item.heightFt,
      sides: item.sides,
      wastePercent: item.wastePercent,
      depthIn: item.depthIn,
      wallTypeId: item.wallTypeId,
      measurements: item.measurements,
    });
    return assembly.components.map((component) => {
      const raw = componentRunQuantity(
        {
          id: component.id,
          description: component.description,
          unit: component.unit,
          basis: component.basis as WallComponentBasis,
          factor: component.factor,
          wastePercent: component.wastePercent,
          roundUp: component.roundUp,
          productionRate: null,
        },
        geometry,
      );
      const quantity = component.roundUp ? Math.ceil(raw) : Math.round(raw * 100) / 100;
      return {
        component,
        quantity,
        cost: component.unitPrice === null ? null : component.unitPrice * quantity,
      };
    });
  }, [item, assembly]);

  const total = parts.reduce((sum, part) => sum + (part.cost ?? 0), 0);
  const unpriced = parts.filter((part) => part.cost === null).length;

  function pick(wallTypeId: string) {
    setError(null);
    setSent(null);
    if (!item) return;
    const form = new FormData();
    form.set("wallTypeId", wallTypeId);
    startTransition(async () => {
      const result = await updateTakeoffItem(jobId, item.id, form);
      if (!result.ok) setError(result.error);
    });
  }

  function send() {
    setError(null);
    setSent(null);
    startTransition(async () => {
      const result = await sendTakeoffItemsToEstimate(jobId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { created, updated, removed, unpriced: noAssembly } = result.value;
      setSent(
        `${created} added, ${updated} updated${removed > 0 ? `, ${removed} removed` : ""}` +
          (noAssembly.length > 0
            ? ` · ${noAssembly.length} item${noAssembly.length === 1 ? "" : "s"} measured but not priced`
            : ""),
      );
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-takeoff="assembly-panel">
      <div className="shrink-0 border-b border-line-card p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Assembly</h2>
        {item ? (
          <>
            <p className="mt-1 truncate text-xs text-ink-body">{item.name}</p>
            {!readOnly && (
              <select
                value={item.wallTypeId ?? ""}
                onChange={(event) => pick(event.target.value)}
                disabled={pending}
                aria-label="Which assembly prices this item"
                data-takeoff="pick-assembly"
                className="mt-1 w-full rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink"
              >
                <option value="">Not priced yet</option>
                {assemblies.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} — {entry.name}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-ink-muted">Pick an item to price it.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {assemblies.length === 0 ? (
          // A REAL EMPTY STATE WITH A WAY OUT. An empty library is the normal
          // state of a new company, and a panel that only says "none" leaves
          // somebody on the wrong page with nothing to press.
          <p className="px-1 py-4 text-xs text-ink-muted" data-takeoff="no-assemblies">
            Your library has no assemblies yet. Add one — or start from the
            trade defaults — on{" "}
            <Link href={wallTypesHref} className="text-link hover:text-link-hover">
              Wall types
            </Link>
            .
          </p>
        ) : !item ? null : !assembly ? (
          <p className="px-1 py-4 text-xs text-ink-muted" data-takeoff="item-unpriced">
            This item is measured but not priced. Pick an assembly above and its parts appear here.
          </p>
        ) : parts.length === 0 ? (
          <p className="px-1 py-4 text-xs text-ink-muted" data-takeoff="assembly-empty">
            {assembly.code} has no parts, so it can produce no lines. Add parts to it on{" "}
            <Link href={wallTypesHref} className="text-link hover:text-link-hover">
              Wall types
            </Link>
            .
          </p>
        ) : (
          <table className="w-full text-[11px]" data-takeoff="assembly-parts">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="font-medium">Part</th>
                <th className="text-right font-medium">Qty</th>
                <th className="text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {parts.map(({ component, quantity, cost }) => (
                <tr key={component.id} className="align-top" data-takeoff="assembly-part">
                  <td className="py-0.5 pr-1">
                    <span className="block text-ink-body">{component.description}</span>
                    <span className="block text-[10px] text-ink-muted">
                      {WALL_BASIS_LABELS[component.basis as WallComponentBasis] ?? component.basis}
                      {component.factor !== 1 ? ` × ${component.factor}` : ""}
                      {component.wastePercent > 0 ? ` + ${component.wastePercent}% waste` : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-0.5 text-right text-ink">
                    {quantity.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                    {component.unit ? <span className="text-ink-muted"> {component.unit}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-0.5 text-right text-ink">
                    {/* A DASH, NOT A ZERO, for a part with no price in the
                        catalog. Zero is a price somebody decided; a dash is
                        the absence of one, and they must not read alike on a
                        column that gets totalled. */}
                    {cost === null ? <span className="text-ink-muted">—</span> : money(cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 border-t border-line-card p-2">
        {parts.length > 0 && (
          <p className="text-[11px] text-ink-body" data-takeoff="assembly-total">
            <span className="font-semibold text-ink">{money(total)}</span> for this item
            {unpriced > 0 && (
              <span className="text-tag-amber-ink">
                {" "}
                · {unpriced} part{unpriced === 1 ? "" : "s"} with no price in the catalog
              </span>
            )}
          </p>
        )}

        {!readOnly && (
          <button
            type="button"
            onClick={send}
            disabled={pending}
            data-takeoff="send-to-estimate"
            className="mt-1.5 w-full rounded-md border border-line-card bg-brand px-2 py-1 text-xs font-medium text-neutral-900 disabled:opacity-50"
          >
            {pending ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner />
                Sending…
              </span>
            ) : (
              "Send takeoff to the estimate"
            )}
          </button>
        )}

        {/* ── IT SAYS IT CAN BE PRESSED AGAIN, because it can ──
            Every other "add to the estimate" in this app refuses a second
            press, because they CREATE and no create here is idempotent. This
            one derives, so re-measuring and pressing again is the workflow
            rather than a mistake — and somebody who does not know that will
            press it once and then re-type the changes by hand. */}
        {!readOnly && (
          <p className="mt-1 text-[10px] leading-snug text-ink-muted">
            Safe to press again after you measure more — it updates the lines it made rather than
            adding them twice.
          </p>
        )}

        {/* ── FREEZE THE LIBRARY FOR THIS JOB ──
            The design doc's answer to "copy the company library into the
            project": don't. A line's price is already written once and never
            re-synced, and EstimateVersion snapshots the whole estimate — so a
            later price change cannot alter a submitted bid, and a copy would
            only add a third place for a price to live.
            What a copy WOULD protect against is narrower and is this: a part
            added to an assembly after the bid was priced appearing on it the
            next time the expander runs. Off by default, because most of the
            time a corrected assembly should correct the open bids too. */}
        {!readOnly && (
          <label className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-ink-muted">
            <input
              type="checkbox"
              checked={pinnedAt !== null}
              disabled={pending}
              onChange={(event) => {
                setError(null);
                const pin = event.target.checked;
                startTransition(async () => {
                  const result = await setAssemblyLibraryPin(jobId, pin);
                  if (!result.ok) setError(result.error);
                });
              }}
              data-takeoff="pin-library"
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
            />
            <span>
              Freeze this job&rsquo;s assemblies
              {pinnedAt !== null && (
                <span className="text-ink-body"> — as they were on {pinnedAt.slice(0, 10)}</span>
              )}
              . Parts added to the library later will not appear on this bid.
            </span>
          </label>
        )}

        {sent && (
          <p className="mt-1 text-[11px] text-ok" role="status" data-takeoff="send-result">
            {sent}
          </p>
        )}
        {error && (
          <p className="mt-1 text-[11px] text-tag-rose-ink" role="alert" data-takeoff="send-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
