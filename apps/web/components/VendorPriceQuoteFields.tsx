"use client";

import { inputClass, labelClass } from "@/components/RfiFields";
import type { VendorOption } from "@/components/MaterialOrderFields";

export type CatalogOption = {
  id: string;
  description: string;
  unit: string | null;
};

export type VendorPriceQuoteDefaults = {
  vendorId: string;
  catalogEntryId: string | null;
  description: string;
  unit: string | null;
  unitPrice: string;
  quotedOn: string;
  validUntil: string | null;
  source: string;
  notes: string | null;
};

/** One field set for create and edit, so the two can't drift into
 * accepting different things. */
export function VendorPriceQuoteFields({
  defaults,
  vendors,
  catalogEntries,
}: {
  defaults: VendorPriceQuoteDefaults;
  vendors: VendorOption[];
  catalogEntries: CatalogOption[];
}) {
  return (
    <>
      <label className={labelClass}>
        Vendor
        <select name="vendorId" required defaultValue={defaults.vendorId} className={inputClass}>
          <option value="" disabled>
            Choose a vendor
          </option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          Whose price this is. Prices are only ever compared between vendors, never averaged into
          one.
        </span>
      </label>

      <label className={labelClass}>
        What they priced, in their words
        <input
          type="text"
          name="description"
          required
          defaultValue={defaults.description}
          placeholder={'e.g. 5/8" Type X gypsum board, 4x12'}
          className={inputClass}
        />
        <span className="text-xs text-slate-500">
          Their wording, not yours — when you ring up to query the price, this is what has to be
          read back to them.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Unit price
          <input
            type="number"
            name="unitPrice"
            step="0.01"
            min="0"
            required
            defaultValue={defaults.unitPrice}
            placeholder="e.g. 0.42"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Per unit
          <input
            type="text"
            name="unit"
            defaultValue={defaults.unit ?? ""}
            placeholder="e.g. SF, MSF, EA"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Their unit, kept as they give it. Prices are only compared within one unit — MSF is
            never converted to SF, because the factor is theirs to state, not ours to guess.
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Quoted on
          <input
            type="date"
            name="quotedOn"
            required
            defaultValue={defaults.quotedOn}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            The day they gave it, not the day you typed it in. Every movement figure is measured
            off this date.
          </span>
        </label>
        <label className={labelClass}>
          Held until
          <input
            type="date"
            name="validUntil"
            defaultValue={defaults.validUntil ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Only if they said so. Leave blank otherwise — an invented expiry would drop a live
            price out of the comparison.
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Where the number came from
        <select name="source" required defaultValue={defaults.source} className={inputClass}>
          <option value="QUOTE">Written quote</option>
          <option value="INVOICE">Off an invoice — what was actually charged</option>
          <option value="PRICE_LIST">Price list — published, not quoted for a job</option>
          <option value="VERBAL">Told verbally — nothing in writing</option>
        </select>
      </label>

      <label className={labelClass}>
        Which catalog item this is for
        <select
          name="catalogEntryId"
          defaultValue={defaults.catalogEntryId ?? ""}
          className={inputClass}
        >
          <option value="">Not linked to a catalog item</option>
          {catalogEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.description}
              {entry.unit ? ` (${entry.unit})` : ""}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          Optional, and the whole point when it&apos;s set: it puts this price next to the catalog
          default you bid off, so a template nobody will sell at shows up before the bid does.
        </span>
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          placeholder="e.g. price holds for a full truck; split loads are 4c more."
          className={inputClass}
        />
      </label>
    </>
  );
}
