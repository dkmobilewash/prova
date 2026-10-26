"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { BID_NAV, activeBidHref } from "@/components/bid/bidNav";

/**
 * C Stream Bid's header — wordmark, the five destinations, and sign-out.
 *
 * DELIBERATELY NOT THE CRM's TOP BAR. That one (components/shell/TopBar.tsx)
 * carries the "All pages" panel, search across every module, Ask, alerts and
 * the money rail — every one of them a door into the CRM, which is the exact
 * thing Bid exists not to have. So this is its own, small, and links only to
 * `/bid` routes (bidLinkCensus.test.ts holds it to that).
 *
 * At 375px the nav wraps under the wordmark as a row of 44px tap targets
 * rather than hiding behind a menu: five words fit, and a menu would be one
 * more tap on every screen for somebody on a jobsite.
 *
 * `useClerk` is called only inside the click handler, so nothing Clerk renders
 * reaches the page — the hydration rule `clerkMountGate.test.ts` enforces.
 */
export function BidHeader({ companyName }: { companyName: string | null }) {
  const pathname = usePathname() ?? "";
  const active = activeBidHref(pathname);
  const { signOut } = useClerk();

  return (
    <header className="border-b border-line-card bg-rail">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/bid/bids" className="flex min-h-11 items-center gap-2" aria-label="C Stream Bid — your bids">
          <Image
            src="/brand/cstream-wordmark.png"
            alt="C Stream"
            width={240}
            height={48}
            className="logo-on-theme h-7 w-auto"
            priority
          />
          <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-900">
            Bid
          </span>
        </Link>

        <nav aria-label="C Stream Bid" className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
          <ul className="flex flex-wrap gap-1">
            {BID_NAV.map((item) => {
              const current = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
                      current ? "bg-rail-hover text-ink" : "text-ink-body hover:bg-rail-hover hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {companyName ? <span className="hidden text-sm text-ink-muted md:inline">{companyName}</span> : null}
          <button
            type="button"
            onClick={() => void signOut({ redirectUrl: "/bid" })}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-ink-body hover:bg-rail-hover hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
