"use client";

import { useRef, useState, useTransition } from "react";
import { createVendorPriceQuote } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import type { VendorOption } from "@/components/MaterialOrderFields";
import {
  VendorPriceQuoteFields,
  type CatalogOption,
} from "@/components/VendorPriceQuoteFields";

/** Collapsed by default. Reading the history is the common case; adding a
 * quote is occasional, and an always-open form pushes the comparison — the
 * reason anyone opens this page — below the fold.
 *
 * `localToday()` is called during this component's render and that is safe
 * ONLY because nothing renders until a click opens the form: a
 * server-rendered default would be the server's date, which after 17:00 in
 * California is already tomorrow. */
export function VendorPriceQuoteForm({
  vendors,
  catalogEntries,
}: {
  vendors: VendorOption[];
  catalogEntries: CatalogOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (vendors.length === 0) {
    return (
      <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
        Add a vendor first — a price with nobody behind it can&apos;t be rung up or compared.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Record a price
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createVendorPriceQuote(formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Record a price</h2>

      <VendorPriceQuoteFields
        vendors={vendors}
        catalogEntries={catalogEntries}
        defaults={{
          vendorId: "",
          catalogEntryId: null,
          description: "",
          unit: null,
          unitPrice: "",
          quotedOn: localToday(),
          validUntil: null,
          source: "QUOTE",
          notes: null,
        }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        {/* Disabled while in flight: no create action here is idempotent,
            and a second click would record the same price twice and skew
            every comparison it feeds. */}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save price"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
