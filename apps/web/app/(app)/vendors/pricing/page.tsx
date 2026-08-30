import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { money } from "@/lib/money";
import { VendorPriceQuoteForm } from "@/components/VendorPriceQuoteForm";
import { VendorPriceQuoteRow } from "@/components/VendorPriceQuoteRow";
import {
  type QuoteData,
  catalogGap,
  currentByUnit,
  newestFirst,
  priceMovement,
  unitLabel,
} from "@/components/vendorPricing";

export const dynamic = "force-dynamic";

/** Quotes for one thing, however that thing is identified. */
type ItemGroup = {
  key: string;
  title: string;
  catalogEntryId: string | null;
  catalogCost: number | null;
  catalogUnit: string | null;
  quotes: QuoteData[];
};

export default async function VendorPricingPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  const [rows, vendors, catalogEntries] = await Promise.all([
    prisma.vendorPriceQuote.findMany({
      where: { companyId: company.id },
      include: {
        vendor: { select: { id: true, name: true } },
        catalogEntry: {
          select: { id: true, description: true, unit: true, defaultBudgetedUnitCost: true },
        },
      },
      orderBy: { quotedOn: "desc" },
    }),
    prisma.vendor.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId: company.id },
      select: { id: true, description: true, unit: true },
      orderBy: { description: "asc" },
    }),
  ]);

  // Dates are stored and rendered at UTC midnight, so "today" for deciding
  // what has expired is the UTC date. (The user's own calendar date is only
  // used for FORM DEFAULTS, in components mounted by a click — see
  // components/localToday.ts.)
  const today = new Date().toISOString().slice(0, 10);

  const quotes: QuoteData[] = rows.map((row) => ({
    id: row.id,
    vendorId: row.vendor.id,
    vendorName: row.vendor.name,
    catalogEntryId: row.catalogEntryId,
    description: row.description,
    unit: row.unit,
    unitPrice: Number(row.unitPrice),
    quotedOn: row.quotedOn.toISOString().slice(0, 10),
    validUntil: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null,
    source: row.source,
    notes: row.notes,
  }));

  // Grouped by catalog item where one is linked, and otherwise by the
  // wording. Wording is a weak key on purpose rather than by oversight:
  // two vendors describing the same board differently will not line up,
  // and the only real fix is linking both to a catalog item. The page says
  // so rather than silently under-grouping.
  const groups = new Map<string, ItemGroup>();
  for (const quote of quotes) {
    const row = rows.find((r) => r.id === quote.id);
    const entry = row?.catalogEntry ?? null;
    const key = entry ? `catalog:${entry.id}` : `text:${quote.description.trim().toLowerCase()}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: entry ? entry.description : quote.description,
        catalogEntryId: entry?.id ?? null,
        catalogCost: entry?.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
        catalogUnit: entry?.unit ?? null,
        quotes: [],
      };
      groups.set(key, group);
    }
    group.quotes.push(quote);
  }

  const items = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Vendor pricing</h1>
      <p className="mb-6 text-sm text-slate-400">
        What your suppliers have actually quoted, and when. Nothing here is stored as a
        &ldquo;current price&rdquo; — current, expired and cheapest are all worked out from the
        quotes every time this page loads, so a price you enter today changes the answer
        immediately.{" "}
        <Link href="/vendors" className="text-blue-400 hover:text-blue-300">
          The vendor directory
        </Link>{" "}
        is where the suppliers themselves live.
      </p>

      <div className="mb-8">
        <VendorPriceQuoteForm vendors={vendors} catalogEntries={catalogEntries} />
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">No prices recorded yet.</p>
          <p className="mt-2 text-sm text-slate-400">
            Record what a supplier last quoted you for the things you buy most — board, studs,
            joint compound. Two quotes for the same item is where this starts earning its keep:
            it will tell you which way the price moved and by how much, which is the number that
            decides whether last quarter&apos;s estimate still holds.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {items.map((item) => {
            const comparisons = currentByUnit(item.quotes, today);
            const gap = catalogGap(item.catalogCost, item.catalogUnit, comparisons);
            const cheapestIds = new Set(comparisons.map((c) => c.cheapest.id));

            // One movement per vendor: how THEIR last two prices for this
            // item compare. Across vendors it wouldn't be a movement.
            const vendorIds = [...new Set(item.quotes.map((q) => q.vendorId))];
            const movements = vendorIds
              .map((vendorId) => priceMovement(item.quotes.filter((q) => q.vendorId === vendorId)))
              .filter((m): m is NonNullable<typeof m> => m !== null && m.changePercent !== 0);

            return (
              <section
                key={item.key}
                className="rounded-lg border border-slate-800 bg-slate-900"
              >
                <header className="border-b border-slate-800 p-4">
                  <h2 className="font-semibold text-slate-100">{item.title}</h2>
                  <p className="text-xs text-slate-500">
                    {item.catalogEntryId ? (
                      <>
                        Linked to a catalog item
                        {item.catalogCost !== null && (
                          <> · catalog cost {money(item.catalogCost)} per {unitLabel(item.catalogUnit)}</>
                        )}
                      </>
                    ) : (
                      <>
                        Not linked to a catalog item — grouped by wording, so another vendor who
                        words it differently won&apos;t line up here.
                      </>
                    )}
                  </p>
                </header>

                {gap && (
                  <div className="border-b border-slate-800 bg-amber-500/5 p-4">
                    <p className="text-sm text-amber-300">
                      Your catalog default is {gap.shortfallPercent}% under what anyone will
                      actually sell this at.
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Catalog says {money(gap.catalogCost)}; the cheapest live quote is{" "}
                      {money(gap.cheapest.unitPrice)} from {gap.cheapest.vendorName}, quoted{" "}
                      {gap.cheapest.quotedOn}. Nothing has been changed — updating the catalog is a
                      decision about your own pricing, and it belongs on{" "}
                      <Link href="/catalog" className="text-blue-400 hover:text-blue-300">
                        the catalog
                      </Link>
                      .
                    </p>
                  </div>
                )}

                {comparisons.length > 0 && (
                  <div className="border-b border-slate-800 p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Live prices
                    </h3>
                    {comparisons.map((comparison) => (
                      <div key={unitLabel(comparison.unit)} className="mb-2 last:mb-0">
                        <p className="text-sm text-slate-300">
                          Per {unitLabel(comparison.unit)}:{" "}
                          <span className="text-emerald-400">
                            {money(comparison.cheapest.unitPrice)} ({comparison.cheapest.vendorName})
                          </span>
                          {comparison.spreadPercent !== null ? (
                            <>
                              {" "}
                              up to {money(comparison.dearest.unitPrice)} (
                              {comparison.dearest.vendorName}) —{" "}
                              <span className="text-slate-400">
                                {comparison.spreadPercent}% spread across{" "}
                                {comparison.quotes.length} vendors
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-500"> — only one vendor has quoted this</span>
                          )}
                        </p>
                      </div>
                    ))}
                    <p className="mt-2 text-xs text-slate-500">
                      Compared only within a unit. A price per MSF is never converted to a price
                      per SF — the factor is the vendor&apos;s to state, and guessing it would make
                      someone look a thousand times cheaper than they are.
                    </p>
                  </div>
                )}

                {movements.length > 0 && (
                  <div className="border-b border-slate-800 p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Movement
                    </h3>
                    {movements.map((movement) => (
                      <p key={movement.to.id} className="text-sm text-slate-300">
                        {movement.to.vendorName}:{" "}
                        <span
                          className={movement.changePercent > 0 ? "text-red-400" : "text-emerald-400"}
                        >
                          {movement.changePercent > 0 ? "up" : "down"}{" "}
                          {Math.abs(movement.changePercent)}%
                        </span>{" "}
                        <span className="text-slate-500">
                          — {money(movement.from.unitPrice)} on {movement.from.quotedOn} to{" "}
                          {money(movement.to.unitPrice)} on {movement.to.quotedOn}
                        </span>
                      </p>
                    ))}
                  </div>
                )}

                <ul className="divide-y divide-slate-800">
                  {newestFirst(item.quotes).map((quote) => (
                    <VendorPriceQuoteRow
                      key={quote.id}
                      quote={quote}
                      today={today}
                      canDelete={currentUser.role === "OWNER"}
                      vendors={vendors}
                      catalogEntries={catalogEntries}
                      isCheapest={cheapestIds.has(quote.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
