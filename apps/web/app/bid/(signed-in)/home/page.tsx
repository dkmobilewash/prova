import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { getOpenJobGuides } from "@/lib/bid/guide";
import { BidHome } from "@/components/bid/BidHome";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Home" };

/**
 * C Stream Bid — the home, and where a signed-in person lands. One box ("What
 * are we bidding today?") and the open bids down the side, each with where it
 * stands and the one thing that needs you.
 *
 * NEW, so it has no CRM twin (`BID_ROUTES` records that, and the capability it
 * enforces is Bid's own). What it reads is `getOpenJobGuides` — derived from
 * each job's own rows on every load, never stored — and the company's GCs for
 * the paste-an-invite box, the same set "Log a bid" offers.
 */
export default async function BidHomePage() {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const companyId = context.company.id;

  const [guides, gcs] = await Promise.all([
    getOpenJobGuides(companyId),
    prisma.contact.findMany({
      where: {
        companyId,
        OR: [{ accountType: null }, { accountType: { in: ["GENERAL_CONTRACTOR", "DEVELOPER"] } }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return <BidHome guides={guides} gcs={gcs} />;
}
