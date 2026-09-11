import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { MobileNav } from "@/components/MobileNav";
import type { Principal } from "@/lib/permissions";

/** Light chrome: white bar with the 2px brand-yellow rule under it, per
 * the approved yellow/black/white mockups. The rail beside it stays dark
 * — that contrast is the design, not a leftover. */
export function Topbar({
  companyName,
  /** Alerts needing attention. Lives in the chrome rather than on the
   * dashboard because a warning that only appears on one page reaches
   * whoever happens to open that page — which is how "expiration alerts"
   * stayed Partial in FEATURE-AUDIT while being visibly implemented.
   * Zero renders the bell without a count rather than hiding it: a
   * control that disappears when it has nothing to say cannot be trusted
   * to appear when it does. */
  alertCount,
  principal,
  showsSalesCrm = false,
}: {
  companyName: string;
  alertCount: number;
  principal: Principal;
  /** Prova's own operating company only -- see Company.isProvaOperator. */
  showsSalesCrm?: boolean;
}) {
  return (
    <div className="print:hidden flex h-14 shrink-0 items-center justify-between gap-3 border-b-2 border-brand bg-surface px-4 sm:px-6">
      {/* Renders nothing above md — the desktop rail is always visible there. */}
      <MobileNav companyName={companyName} principal={principal} showsSalesCrm={showsSalesCrm} />
      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/alerts"
          aria-label={
            alertCount === 0
              ? "Alerts — nothing needs attention"
              : `Alerts — ${alertCount} needing attention`
          }
          className="relative rounded-md p-2 text-ink-body hover:bg-neutral-100 hover:text-ink"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
            <path
              d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5c0 3-1.5 4-1.5 4h12s-1.5-1-1.5-4A4.5 4.5 0 0 0 10 3.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M8.5 14.5a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[1.15rem] rounded-full bg-red-600 px-1 text-center text-[0.65rem] font-semibold leading-[1.15rem] text-white">
              {alertCount > 99 ? "99+" : alertCount}
            </span>
          )}
        </Link>
        <UserButton />
      </div>
    </div>
  );
}
