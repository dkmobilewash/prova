import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { BidComingSoon } from "@/components/bid/BidComingSoon";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Price book" };

/**
 * C Stream Bid — the price book (`LineItemCatalogEntry`). Not on the chain's
 * screens, but the chain cannot produce a price without it: a wall type's
 * parts price from it (`lib/estimating/wall-schedule.ts`,
 * `unitPrice: entry?.defaultUnitPrice ?? null`), and a wall line with no
 * price-book price comes in cost-only — the "$0 bid" seam. A STUB in this
 * build.
 *
 * PORTING BRIEF (wave 2). Source: `app/(app)/catalog/page.tsx` (725 lines).
 * Its own markup carries no CRM href; what leaks is what it imports —
 * `components/PageHeader.tsx` (breadcrumb `/dashboard`, imports
 * `components/navItems.tsx`), `components/NoAccess.tsx` (`/dashboard`) and
 * `components/EmptyState.tsx` → `components/EmptyStateButtons.tsx:86`
 * (`router.push("/ask")`). Swap those three for Bid's own heading, BidNoAccess
 * and a Bid empty state; the catalog forms themselves port as-is. Its owner-only
 * deletes go through `ownerRefusal` already (`catalog-owner-refusal.test.ts`).
 */
export default async function BidPriceBookPage() {
  const { allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  return (
    <PageShell width="working">
      <BidComingSoon
        title="Price book"
        purpose={
          <p>
            Your materials and their prices — studs, track, board, finish. Your wall types price from it, so a wall
            line gets a price instead of coming in at cost only.
          </p>
        }
      />
    </PageShell>
  );
}
