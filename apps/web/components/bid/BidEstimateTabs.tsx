"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeBidEstimateTab, bidEstimateTabs } from "@/components/bid/bidEstimateTabs";

/**
 * The tab row under a C Stream Bid estimate's header. A client component only
 * to read the pathname for `aria-current`; the tabs themselves are plain links
 * (`bidEstimateTabs`), each a real route, so Cmd-click opens one in a tab and a
 * refresh lands where you were.
 *
 * 44px tap targets, wrapping at 375px rather than scrolling sideways.
 */
export function BidEstimateTabs({ jobId }: { jobId: string }) {
  const pathname = usePathname() ?? "";
  const active = activeBidEstimateTab(pathname, jobId);
  return (
    <nav aria-label="This estimate" className="mb-5">
      <ul className="flex flex-wrap gap-1 border-b border-line-card pb-2" data-bid="estimate-tabs">
        {bidEstimateTabs(jobId).map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                data-bid-tab={tab.key}
                className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
                  current ? "bg-rail-hover text-ink" : "text-ink-body hover:bg-rail-hover hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
