/**
 * The one nav list, shared by the desktop rail and the mobile drawer.
 *
 * Extracted so the two cannot drift: a route added to one and forgotten
 * in the other means a feature that exists on a laptop and not on a phone,
 * which is the kind of gap nobody notices until a foreman reports it.
 */

import type { ReactNode } from "react";

export type NavItem = { href: string; label: string; icon: ReactNode };

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Jobs & Estimates",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M6.5 6V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1M4 8.5A1.5 1.5 0 0 1 5.5 7h9A1.5 1.5 0 0 1 16 8.5V15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15V8.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M4 10.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/schedule",
    label: "Schedule",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 8.5h13M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/contacts",
    label: "Contacts",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M4.5 16c0-2.8 2.46-4.5 5.5-4.5s5.5 1.7 5.5 4.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/bids",
    label: "Bids",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M10 3.5v13M4.5 13c0 1.4 1.6 2.5 3.5 2.5h4c1.9 0 3.5-1.1 3.5-2.5s-1.6-2.5-3.5-2.5h-4c-1.9 0-3.5-1.1-3.5-2.5S6.1 5.5 8 5.5h4c1.9 0 3.5 1.1 3.5 2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/catalog",
    label: "Catalog",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 8h13M7.5 8v8.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    href: "/compliance",
    label: "Compliance",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M6 3.5h6l2.5 2.5v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M7 9.5h6M7 12.5h6M7 6.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/team",
    label: "Team",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="7" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="14" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M2.8 16c0-2.4 2-4 4.2-4s4.2 1.6 4.2 4M12.2 12.6c1.7.1 3.2 1.4 3.2 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/vendors",
    label: "Vendors",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3 8.5 4.2 5A1.5 1.5 0 0 1 5.6 4h8.8a1.5 1.5 0 0 1 1.4 1L17 8.5M3 8.5h14M3 8.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15V8.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 11.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/material-orders",
    label: "Material orders",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M3.5 6.5 10 10m0 0 6.5-3.5M10 10v7" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/equipment",
    label: "Equipment",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 15.5h12M5.5 15.5V9l4-4.5 5 3.5v7.5M9.5 15.5v-3.5h2.5v3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/punch-lists",
    label: "Punch lists",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 5.5 5.5 7l2.5-3M4 12.5 5.5 14l2.5-3M11 6h5M11 13h5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/closeout",
    label: "Closeout",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V5A1.5 1.5 0 0 1 5 3.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="m7 10 2 2 4-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5c0 3-1.5 4-1.5 4h12s-1.5-1-1.5-4A4.5 4.5 0 0 0 10 3.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8.5 14.5a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/backcharges",
    label: "Backcharges",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 10h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/rfis",
    label: "RFIs",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H8l-4 3V5.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8.5 7.4a1.6 1.6 0 1 1 1.9 1.9v.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/submittals",
    label: "Submittals",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M6 3.5h6.5L16 7v9.5A1.5 1.5 0 0 1 14.5 18h-8A1.5 1.5 0 0 1 5 16.5v-11A1.5 1.5 0 0 1 6.5 3.5H6Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M12.5 3.5V7H16" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="m7.75 12.25 1.5 1.5 3-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/drawings",
    label: "Drawings",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3 5.5 7.5 4l5 1.5L17 4v10.5L12.5 16l-5-1.5L3 16V5.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M7.5 4v10.5M12.5 5.5V16" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/safety",
    label: "Safety",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M10 3 4.5 5.2v4.4c0 3.2 2.3 6 5.5 6.9 3.2-.9 5.5-3.7 5.5-6.9V5.2L10 3Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M7.7 9.8 9.4 11.5l3-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/cash-flow",
    label: "Cash flow",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 14.5V9M8 14.5v-8M12.5 14.5v-5M17 14.5V6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/field-reports",
    label: "Field reports",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M5.5 3.5h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path d="M7.5 7.5h5M7.5 10.5h5M7.5 13.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/vendors/pricing",
    label: "Vendor pricing",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path d="M4 14.5 8 10l3 3 5-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 7h3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M10 3.5v1.6M10 14.9v1.6M16.5 10h-1.6M5.1 10H3.5M14.6 5.4l-1.13 1.13M6.53 13.47 5.4 14.6M14.6 14.6l-1.13-1.13M6.53 6.53 5.4 5.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];


/**
 * The rail's five buckets.
 *
 * Eighteen flat links is a list you scan; five groups is a list you read.
 * The grouping is by when in a job's life you reach for the thing, not by
 * which table it lives in — a foreman looking for punch lists is thinking
 * "we're finishing", not "operations".
 *
 * Every item here has a live route. An earlier plan for this rail assumed
 * eight of these were unbuilt and should render disabled with a "coming
 * soon" tooltip; they all shipped during the day it was written, so
 * disabling them would have removed working features from the nav. If a
 * genuinely unbuilt item is ever added, give it `disabled: true` and the
 * rail already renders it muted and unclickable.
 */
export type NavGroup = {
  heading: string;
  items: (NavItem & { disabled?: boolean })[];
};

import { canReach, type Principal } from "@/lib/permissions";

const byHref = new Map(NAV_ITEMS.map((item) => [item.href, item]));
const item = (href: string): NavItem => {
  const found = byHref.get(href);
  if (!found) throw new Error(`navItems: no item for ${href}`);
  return found;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Pre-construction",
    items: [item("/dashboard"), item("/alerts"), item("/bids"), item("/contacts"), item("/catalog")],
  },
  {
    heading: "Operations",
    items: [
      item("/schedule"),
      item("/rfis"),
      item("/submittals"),
      item("/drawings"),
      item("/punch-lists"),
      item("/closeout"),
    ],
  },
  {
    heading: "Compliance & safety",
    items: [item("/compliance"), item("/safety"), item("/team")],
  },
  {
    heading: "Logistics",
    items: [item("/material-orders"), item("/vendors"), item("/equipment")],
  },
  {
    heading: "Financials",
    items: [item("/cash-flow"), item("/backcharges"), item("/settings")],
  },
];

/**
 * The rail as one person sees it.
 *
 * NOT a security boundary, and it must never be mistaken for one — hiding
 * a link hides nothing, since the URL still exists and can be typed or
 * pasted from a colleague. requireCapability() on the page is the
 * boundary; this only stops the rail advertising doors that will not open,
 * and drops a group that empties out entirely so nobody gets a heading
 * with nothing under it.
 *
 * One function used by both the desktop rail and the mobile drawer, for
 * the same reason NAV_GROUPS itself is shared: a filter applied in one and
 * forgotten in the other is a feature that exists on a phone and not on a
 * laptop.
 */
export function navGroupsFor(user: Principal): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canReach(user, item.href)),
  })).filter((group) => group.items.length > 0);
}
