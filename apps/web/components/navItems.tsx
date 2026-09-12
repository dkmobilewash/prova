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
    href: "/messages",
    label: "Messages",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 6A1.5 1.5 0 0 1 5 4.5h10A1.5 1.5 0 0 1 16.5 6v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V6Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="m4 6.5 6 4.5 6-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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
    href: "/pipeline",
    label: "Pipeline",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 5.5h13M5.5 10h9M8 14.5h4"
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
  // Back on the rail 11 Sep 2026 (#240), under "Paper trail" — see the
  // NAV_GROUPS comment for why the 3 Sep cut no longer applies.
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
    href: "/union-compliance",
    label: "Union & fringe",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="7" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="13.5" cy="8.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
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
    href: "/prevailing-wage",
    label: "Prevailing wage",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path d="M10 3.5v13M5 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path
          d="M5 7 3 11.5a2.2 2.2 0 0 0 4 0L5 7Zm10 0-2 4.5a2.2 2.2 0 0 0 4 0L15 7Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
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
    href: "/certifications",
    label: "Certifications",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="m7.6 11.2-1.1 5 3.5-1.9 3.5 1.9-1.1-5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
    href: "/photos",
    label: "Site photos",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 6.5h2.2l1.1-1.8h6.4l1.1 1.8h2.2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="11" r="2.6" stroke="currentColor" strokeWidth="1.4" />
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
    href: "/deployment",
    label: "Deployment",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="6.5" cy="6" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="13.5" cy="6" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 16v-1.5A2.5 2.5 0 0 1 5.5 12h2A2.5 2.5 0 0 1 10 14.5V16M10 16v-1.5A2.5 2.5 0 0 1 12.5 12h2a2.5 2.5 0 0 1 2.5 2.5V16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
  // Not in NAV_ITEMS's usual home in a NAV_GROUPS group below -- this one
  // is for Prova's own operating company only (Company.isProvaOperator),
  // never a tenant, so it is appended separately by navGroupsFor rather
  // than filtered by the job-function capability system every other item
  // uses. See SALES_NAV_GROUP.
  {
    href: "/sales",
    label: "Sales CRM",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 15.5V11l4-2.5 3.5 2 5.5-4.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12.5 6h3.5v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];


/**
 * The rail's six buckets, in the order money moves through a sub's year.
 *
 * The grouping is by when in a job's life you reach for the thing, not by
 * which table it lives in — a foreman looking for punch lists is thinking
 * "we're finishing", not "operations". The ORDER is the pipeline: win the
 * work, build it, keep the paper straight, buy and move what it needs, get
 * paid, stay compliant. Settings sits with the money because that is
 * where the owner lives.
 *
 * **11 Sep 2026 — the rail collapses, and the four cut on 3 Sep are back
 * (#240).** The rail rendered every group open: 27 labels to read to find
 * anything, which is the "way too many menus" complaint the category's
 * one-star reviews are made of. Each group is now a header that toggles,
 * only the group holding the current page is open, and the six headers
 * fit a laptop screen without scrolling. Sidebar.tsx and MobileNav.tsx
 * share the rule through useNavAccordion so the two cannot disagree about
 * which group is open. Every group carries an `icon` because at 64px the
 * rail shows nothing else for it.
 *
 * RFIs, Submittals, Drawings and Closeout return under "Paper trail". The
 * 3 Sep cut (NAV-IA-AUDIT.md) had two grounds: a sub does not RUN those
 * workflows, and a flat rail could not afford four more labels. The
 * second ground is gone — a collapsed group costs one header whether it
 * holds one item or five — and the first was always an argument about
 * what to build, not about whether a sub needs to find the RFI it sent
 * last Tuesday. Cyrus asked for them findable. Nothing behind the routes
 * changed then or now.
 *
 * `/safety` and `/material-orders` stay `disabled: true` for the reason
 * the audit gives: not validated yet as a daily need for this persona. A
 * genuinely unbuilt item gets `disabled: true` too, and both surfaces
 * already render it muted and unclickable.
 */
export type NavGroup = {
  heading: string;
  /** Shown at 64px, where the heading text is not — the only thing a
   * collapsed rail says about a group. */
  icon: ReactNode;
  items: (NavItem & { disabled?: boolean })[];
};

import { canReach, type Principal } from "@/lib/permissions";

const byHref = new Map(NAV_ITEMS.map((item) => [item.href, item]));
const item = (href: string): NavItem => {
  const found = byHref.get(href);
  if (!found) throw new Error(`navItems: no item for ${href}`);
  return found;
};

const groupIcon = (d: string) => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Pre-construction",
    // A flag: the work you are chasing.
    icon: groupIcon("M5 16.5v-13M5 4h9.5l-2.5 3.25 2.5 3.25H5"),
    items: [
      item("/dashboard"),
      item("/alerts"),
      item("/bids"),
      item("/pipeline"),
      item("/contacts"),
      item("/messages"),
      item("/catalog"),
    ],
  },
  {
    heading: "Operations",
    // A hard hat: the work under way.
    icon: groupIcon("M3.5 14h13M5 14v-1.5a5 5 0 0 1 10 0V14M10 7.5V4M8 4h4"),
    items: [
      item("/schedule"),
      // Next to the schedule on purpose. The schedule answers WHEN jobs
      // run; deployment answers WHERE everybody and everything is right
      // now, and the page says so in its own first paragraph. Grouping is
      // by when in a job's life you reach for the thing, not by which
      // table it reads — which is the argument for filing it under
      // Logistics beside Equipment, and the thing this rail deliberately
      // does not do. A page in NAV_ITEMS but in no group renders nowhere:
      // both the rail and the mobile drawer draw from navGroupsFor().
      item("/deployment"),
      item("/punch-lists"),
      item("/field-reports"),
      // Beside field reports, because it answers the same question on the
      // same day — the report says what happened, the photos show it. Both
      // are reached from a phone on site rather than from a desk, which is
      // what this group is.
      item("/photos"),
    ],
  },
  {
    heading: "Paper trail",
    // A document with a corner fold: what went to the GC, and when.
    icon: groupIcon("M6 3.5h6l3 3v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM12 3.5v3h3M7.5 10h5M7.5 13h5"),
    // Question, answer, drawing, sign-off: the order the paper arrives in.
    items: [item("/rfis"), item("/submittals"), item("/drawings"), item("/closeout")],
  },
  {
    heading: "Logistics",
    // A truck.
    icon: groupIcon("M3.5 6.5h8v7h-8zM11.5 9.5h2.8l2.2 2.2v1.8h-5zM6 15.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM14 15.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"),
    items: [
      { ...item("/material-orders"), disabled: true },
      item("/vendors"),
      item("/vendors/pricing"),
      item("/equipment"),
    ],
  },
  {
    heading: "Financials",
    // A bank note.
    icon: groupIcon("M3.5 6.5h13v7h-13zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 10h.01M14 10h.01"),
    items: [item("/cash-flow"), item("/backcharges"), item("/settings")],
  },
  {
    heading: "Compliance & safety",
    // A clipboard with a tick.
    icon: groupIcon("M7 4.5h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM8 4.5v-1h4v1M8 10.5l1.5 1.5 2.5-3"),
    items: [
      item("/compliance"),
      item("/prevailing-wage"),
      item("/union-compliance"),
      { ...item("/safety"), disabled: true },
      item("/certifications"),
      item("/team"),
    ],
  },
];

/**
 * The heading of the group that holds the current page, or null when no
 * group does (the sign-in pages, a portal). Longest matching href wins, so
 * `/vendors/pricing` and `/settings/assistant` land in the group of the
 * page they hang off rather than the first prefix that happens to match.
 * Pure, so navItems.test.ts can pin it; both nav surfaces read it through
 * useNavAccordion.
 */
export function activeGroupHeading(groups: NavGroup[], pathname: string): string | null {
  let best: { heading: string; length: number } | null = null;
  for (const group of groups) {
    for (const entry of group.items) {
      const matches = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
      if (matches && (!best || entry.href.length > best.length)) {
        best = { heading: group.heading, length: entry.href.length };
      }
    }
  }
  return best?.heading ?? null;
}

/** Prova's own sales pipeline for selling Prova itself -- deliberately
 * outside NAV_GROUPS above, which every tenant's nav is built from. Only
 * ever appended by navGroupsFor, and only when the caller says so. */
const SALES_NAV_GROUP: NavGroup = {
  heading: "Internal",
  icon: item("/sales").icon,
  items: [item("/sales")],
};

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
export function navGroupsFor(user: Principal, options: { showsSalesCrm?: boolean } = {}): NavGroup[] {
  const groups = options.showsSalesCrm ? [...NAV_GROUPS, SALES_NAV_GROUP] : NAV_GROUPS;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canReach(user, item.href)),
    }))
    .filter((group) => group.items.length > 0);
}
