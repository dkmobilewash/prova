import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { CatalogEntryAddForm, CatalogEntryItem, CatalogListHeader } from "@/components/CatalogParts";
import { CatalogImport } from "@/components/CatalogImport";
import { CollapsedForm } from "@/components/CollapsedForm";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Price book" };

/**
 * C Stream Bid — the price book (`LineItemCatalogEntry`). Not on the chain's
 * screens, but the chain cannot produce a price without it: a wall type's
 * parts price from it (`lib/estimating/wall-schedule.ts`,
 * `unitPrice: entry?.defaultUnitPrice ?? null`), and a wall line with no
 * price-book price comes in cost-only — the "$0 bid" seam.
 *
 * THE CRM'S OWN PIECES (`components/CatalogParts.tsx`, moved out of
 * `/catalog` unchanged): the add form, the column header, one entry's row —
 * and the same price-list import. Same rows, so a price set here is the one
 * the CRM shows and the one a wall type prices from.
 *
 * What the CRM page has under each entry and this one does not: the actuals
 * against budget (job costing) and the vendor quotes — both past the bid.
 * What it has around the list and this one does not: estimate templates. And
 * its `PageHeader` (breadcrumb `Home → /dashboard`), `NoAccess` (`/dashboard`)
 * and `EmptyState` (an Ask action that pushes `/ask`) are replaced by Bid's
 * own heading, `BidNoAccess` and the empty state below.
 *
 * Same capability as `/catalog`: MANAGE_ESTIMATING. The owner-only import is
 * withheld from anyone else the way the CRM withholds it (the action refuses
 * a non-owner regardless).
 */
export default async function BidPriceBookPage() {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const companyId = context.company.id;
  const isOwner = context.role === "OWNER";

  const [entries, craftClassifications] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId },
      orderBy: { description: "asc" },
      include: {
        craftClassification: { include: { unionLocal: true } },
        // What a delete would orphan — the same count the CRM row is given.
        jobLineItems: { where: { isDeleted: false }, select: { id: true } },
      },
    }),
    prisma.craftClassification.findMany({
      where: { companyId },
      include: { unionLocal: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PageShell width="working">
      <h1 className="mb-1 font-headline text-3xl font-semibold text-ink">Price book</h1>
      <p className="mb-6 max-w-3xl text-sm text-ink-body">
        Your materials and their prices — studs, track, board, finish. Your wall types price from it, so a wall line
        gets a price instead of coming in at cost only. Reusable line items for estimating: add one here, then pull it
        into an estimate with &ldquo;Add from catalog&rdquo;.
      </p>

      <div className="mb-6 flex flex-wrap items-start gap-3">
        <section data-bid="price-book-add">
          <CollapsedForm label="Add a catalog entry">
            <CatalogEntryAddForm craftClassifications={craftClassifications} />
          </CollapsedForm>
        </section>
        <div data-bid="price-book-import">
          <CatalogImport existingDescriptions={entries.map((entry) => entry.description)} canImport={isOwner} />
        </div>
      </div>

      <section className="mb-8">
        {entries.length === 0 ? (
          <div className="flex max-w-prose flex-col gap-2 rounded-lg border border-line-card bg-surface p-5" data-bid="no-catalog">
            <h2 className="text-lg font-semibold text-ink">No catalog entries yet</h2>
            <p className="text-sm text-ink-body">
              The things you put on every estimate — a sheet of drywall hung and finished, a stud, a day of demo — with
              the unit and what you charge. Add them once, or paste a price list from a spreadsheet, and pull them
              into any estimate in two clicks instead of retyping prices.
            </p>
          </div>
        ) : (
          <>
            <CatalogListHeader />
            <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-bid="price-book-list">
              {entries.map((entry) => (
                <CatalogEntryItem key={entry.id} entry={entry} linkedLineCount={entry.jobLineItems.length} />
              ))}
            </ul>
          </>
        )}
      </section>
    </PageShell>
  );
}
