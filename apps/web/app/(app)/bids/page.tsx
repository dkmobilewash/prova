import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { BidLog } from "@/components/BidLog";

/**
 * The CRM's bid log. The page itself is `components/BidLog.tsx`, which C Stream
 * Bid's `/bid/bids` renders too; this file is what is the CRM's alone — the
 * capability gate, the `PageHeader` and the first-run `EmptyState`, whose links
 * (`/dashboard`, `/ask`, `/contacts`, `/pipeline`) a Bid page may not carry.
 * Rendered with the default surface, which is every character `/bids` drew
 * before the log was shared. (`BidLog` is CALLED rather than rendered as an
 * element: the page's tests await the page and render what it returns, and an
 * async element cannot be rendered synchronously. The output is identical.)
 */
export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; status?: string; new?: string; view?: string; all?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;

  return BidLog({
    searchParams,
    company: context.company,
    header: (
      <PageHeader
        route="/bids"
        title="Bid history"
        subtitle="Every bid invitation from every GC — filter by trade or outcome to see what similar work priced at."
      />
    ),
    emptyState: (
      <EmptyState
        data-tour="bids-empty"
        title="No bids logged yet"
        purpose={
          <p>
            Everything you have been asked to price, who asked, and how it went — won, lost or
            still out. Once a few are in, filtering by type of work shows what similar jobs went
            for last time, which is the number you want when someone asks for a ballpark on the
            phone.
          </p>
        }
        actions={[{ label: "Open your contacts", href: "/contacts" }, { label: "See the pipeline", href: "/pipeline" }]}
        ask="Northside Builders invited us to bid the Oak Ave addition, due October 3"
        sources={
          <p>
            A bid is logged on the page of whoever asked for the price — a GC, a developer
            or a construction manager — under Bid invitations. Open the contact, or add them first.
          </p>
        }
        example={{
          rows: [
            { title: "Oak Ave addition", tag: "Submitted", detail: "Northside Builders · due Oct 3", meta: "$48,500" },
            { title: "Maple St. bathroom", tag: "Won", detail: "Jane Smith · decided Aug 20", meta: "$18,200" },
            { title: "Hillcrest deck", tag: "Lost", detail: "Ridge Homes · went $3,000 lower", meta: "$22,900" },
          ],
        }}
      />
    ),
  });
}
