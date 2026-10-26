import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BidHeader } from "@/components/bid/BidHeader";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

/**
 * C Stream Bid's signed-in shell: its own header and nav, and nothing of the
 * CRM's — no top bar, no "All pages", no Ask, no alerts, no money rail.
 *
 * SAME ACCOUNT. `requireCompanyContext` is the CRM's own entry point, unchanged:
 * the first signed-in Bid page a new person reaches creates their User and
 * Company exactly as /dashboard would, so a Bid company that later uses the
 * CRM keeps every job it made here. Middleware has already required a session
 * (`isBidSignedInPath` in lib/bid/surface.ts).
 *
 * The capability check here is the NAV-level answer — the whole surface is
 * estimating, so somebody without it sees why rather than five empty screens.
 * Each page still checks for itself with `requireCapability`, because a layout
 * is not a boundary for the page beneath it (they render concurrently).
 */
export default async function BidSignedInLayout({ children }: { children: React.ReactNode }) {
  const context = await requireCompanyContext();
  const allowed = can(context, BID_CAPABILITY);
  return (
    <div className="bg-canvas">
      <BidHeader companyName={context.company.name} />
      <main id="main">{allowed ? children : <BidNoAccess />}</main>
    </div>
  );
}
