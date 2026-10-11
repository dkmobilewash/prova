import { canOpen } from "@/components/navItems";
import type { Principal } from "@/lib/permissions";

/**
 * The six AREAS of the app (Concept H, 2026-10-10) — the boxes on the home
 * page and the pages at /areas/[slug].
 *
 * The owner's words: "you can't see where anything is and I don't want
 * people to have to use search all the time — small boxes on the front page
 * for where everything is, click one and a dropdown goes to another page
 * with all the stuff that feature uses."
 *
 * So every destination the old rail offered (components/navItems.tsx's
 * NAV_ITEMS) is filed in exactly ONE area, named for what a sub is doing
 * when they reach for it rather than for the table it lives in.
 * areas.test.ts derives the set from NAV_ITEMS itself: a nav entry added
 * without an area — or without a written reason in NOT_IN_AN_AREA — fails
 * the build instead of quietly becoming a page nobody can find.
 *
 * Pure data and one filter. Which tools a person sees is `canOpen` from
 * navItems.tsx, which is `canReach` from lib/permissions.ts plus the
 * owner-only footer pages — the same rule the rail, the "All pages" menu
 * and search use, so no box can offer a door the page behind it refuses.
 * Like navGroupsFor, this is NOT a security boundary; each page's own
 * requireCapability is.
 */

export type AreaSlug =
  | "jobs-bids"
  | "money"
  | "crew-field"
  | "paperwork"
  | "compliance-safety"
  | "materials-equipment";

export type AreaTool = {
  /** The page this tool opens — a NAV_ITEMS href, or an anchor on one. */
  href: string;
  /** The NAV_ITEMS href this tool stands for, when `href` carries an
   * anchor. The census and the capability filter both read this one. */
  route?: string;
  name: string;
  /** The area card's button, when "Open <name>" will not fit on one line
   * of a desktop card. Short and specific ("Open closeout"), never a bare
   * "Open" — areas.test.ts holds every label under the measured ceiling. */
  action?: string;
  /** One line, phrased as what you would come here to do. */
  description: string;
};

export type Area = {
  slug: AreaSlug;
  name: string;
  description: string;
  /** SVG path data on a 24-box, stroked — drawn by components/areas/AreaIcon. */
  icon: string[];
  tools: AreaTool[];
  /** The tools whose live status makes up the area's one line on the home
   * box, in order. A tool with no cheap real count is not listed; when none
   * of these has a status the box shows `description` instead. */
  headline: string[];
};

export const AREAS: Area[] = [
  {
    slug: "jobs-bids",
    name: "Jobs & bids",
    description: "Your jobs, the bids you are chasing and how you price them.",
    icon: ["M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M8 7V4h8v3M3 12h18"],
    headline: ["/dashboard", "/bids"],
    tools: [
      // The jobs list lives on the home page (/jobs redirects there).
      { href: "/dashboard#all-jobs", route: "/dashboard", name: "Jobs", description: "Every job, by stage, with its estimate and contract" },
      { href: "/bids", name: "Bids", description: "Bid invitations from GCs and how each one went" },
      // The AI home (2026-10-11). Here rather than in an area of its own:
      // a seventh box for one page is a box that opens onto one card, and
      // what the agents read and advise on is these bids. /ai/activity and
      // /ai/bids/[id] are not nav entries (areas.test.ts takes only those);
      // they are reached from /ai itself.
      { href: "/ai", name: "AI", description: "Agents watching your bids, and the chat" },
      { href: "/pipeline", name: "Pipeline", description: "Projects you are chasing before the invite comes" },
      { href: "/contacts", name: "Contacts", description: "GCs, architects and the people you work with" },
      { href: "/catalog", name: "Price book", description: "Your line items, rates and what they really cost" },
      { href: "/proposals", name: "Proposal clauses", action: "Open clauses", description: "Inclusions, exclusions and terms for proposals" },
      { href: "/wall-types", name: "Wall types", description: "Assemblies you price by the foot" },
    ],
  },
  {
    slug: "money",
    name: "Money",
    description: "Who owes you, what is held back and what the work costs.",
    icon: ["M2.5 8a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z", "M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM6 9.5v5M18 9.5v5"],
    headline: ["/cash-flow"],
    tools: [
      { href: "/cash-flow", name: "Cash flow", description: "Who owes you, how late, and retainage held" },
      { href: "/wip", name: "Work in progress", description: "Over and under billing on every open job" },
      { href: "/backcharges", name: "Backcharges", description: "Charges the GC put against you, and your answer" },
      { href: "/lien-deadlines", name: "Lien deadlines", description: "Notices and lien dates that protect getting paid" },
      { href: "/phase-codes", name: "Phase codes", description: "Budget against actual by phase, across jobs" },
    ],
  },
  {
    slug: "crew-field",
    name: "Crew & field",
    description: "Who is where, what the crew wrote down, and what is left to fix.",
    icon: ["M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M17 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17 14c2.5 0 4 1.8 4 4.5"],
    headline: ["/schedule"],
    tools: [
      { href: "/schedule", name: "Schedule", description: "Which crew is on which job, day by day" },
      { href: "/deployment", name: "Deployment", description: "Where every person and machine is right now" },
      { href: "/field-reports", name: "Field reports", description: "The daily report: weather, work done, delays" },
      { href: "/photos", name: "Site photos", description: "Every photo from every job, tagged and dated" },
      { href: "/punch-lists", name: "Punch lists", description: "What is left to fix before you are done" },
      { href: "/team", name: "Team", description: "Your people, their trades and their papers" },
    ],
  },
  {
    slug: "paperwork",
    name: "Paperwork",
    description: "RFIs, submittals, drawings and everything you send the GC.",
    icon: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5M9 13h6M9 17h4"],
    headline: ["/rfis"],
    tools: [
      { href: "/rfis", name: "RFIs", description: "Questions to the GC and their answers" },
      { href: "/submittals", name: "Submittals", description: "Product data, samples and shop drawings" },
      { href: "/drawings", name: "Drawings", description: "Current sets, revisions and markups" },
      { href: "/closeout", name: "Closeout & warranty", action: "Open closeout", description: "O&M manuals, warranties, as-builts" },
      { href: "/intake", name: "Document intake", action: "Open intake", description: "Drop a PDF and file it to the right job" },
      { href: "/messages", name: "Messages", description: "What you sent GCs, architects and vendors" },
      { href: "/alerts", name: "Alerts", description: "Everything flagged across the app, in one list" },
    ],
  },
  {
    slug: "compliance-safety",
    name: "Compliance & safety",
    description: "What you have to prove to stay on the job.",
    icon: ["M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z", "M12 8v5M12 16h.01"],
    headline: ["/compliance"],
    tools: [
      { href: "/compliance", name: "Compliance", description: "Insurance, licences and bonds, and when they lapse" },
      { href: "/safety", name: "Safety", description: "Incidents, the OSHA log and toolbox talks" },
      { href: "/certifications", name: "Certifications", description: "Who holds which card, and when it runs out" },
      { href: "/prevailing-wage", name: "Prevailing wage", description: "Wage determinations and certified payroll" },
      { href: "/union-compliance", name: "Fringe & apprentices", action: "Open fringe", description: "Union fringe reports and apprentice ratios" },
    ],
  },
  {
    slug: "materials-equipment",
    name: "Materials & equipment",
    description: "Getting material and machines to the job.",
    icon: ["M3 8l9-5 9 5v8l-9 5-9-5z", "M3 8l9 5 9-5M12 13v8"],
    headline: ["/material-orders"],
    tools: [
      { href: "/material-orders", name: "Material orders", description: "What is on order, who owes it, and what is late" },
      { href: "/vendors", name: "Vendors", description: "Suppliers and rental houses you buy from" },
      { href: "/vendors/pricing", name: "Vendor pricing", description: "Quoted prices to check the next order against" },
      { href: "/equipment", name: "Equipment", description: "Your machines and tools, and where each one is" },
    ],
  },
];

/**
 * Nav destinations deliberately in NO area, each with the reason. A nav
 * entry must be either in an area or here — areas.test.ts holds both.
 */
export const NOT_IN_AN_AREA: Record<string, string> = {
  "/ask": "Asking is the search box on every page, not a place you go.",
  "/settings": "The account itself, under the avatar menu on every page.",
  "/settings/integrations": "Connected apps, owner-only, under the avatar menu beside Settings.",
  "/sales": "C Stream's own sales pipeline, only for the operating company.",
  "/internal/usage": "C Stream's own usage page, only for the operating company.",
};

export const areaHref = (slug: AreaSlug) => `/areas/${slug}`;

export function areaBySlug(slug: string): Area | undefined {
  return AREAS.find((area) => area.slug === slug);
}

/** The nav href a tool stands for. */
export const toolRoute = (tool: AreaTool) => tool.route ?? tool.href;

/**
 * The areas as one person sees them: each area's tools narrowed to the ones
 * they can open, and an area left with none dropped entirely — a box that
 * opens onto nothing is the door that will not open.
 */
export function areasFor(principal: Principal): Area[] {
  return AREAS.map((area) => ({
    ...area,
    tools: area.tools.filter((tool) => canOpen(principal, toolRoute(tool))),
  })).filter((area) => area.tools.length > 0);
}


/* ------------------------------------------------- with live status -- */

export type Tone = "red" | "amber" | "green";
/** One real figure about a tool, from lib/areas-data.ts. */
export type ToolStatus = { text: string; tone?: Tone };
export type ToolStatuses = Record<string, ToolStatus>;

export type AreaView = {
  slug: AreaSlug;
  name: string;
  href: string;
  icon: string[];
  description: string;
  /** The box's one line as its parts, each with its own tone, or empty
   * when no headline tool has a real figure —
   * the box then shows `description`. Never a made-up number. */
  line: ToolStatus[];
  tools: (AreaTool & { route: string; status: ToolStatus | null })[];
};

/** Plain data for the boxes and the area page: each tool's status, and the
 * area's one line from its headline tools' statuses. */
export function areaViews(areas: Area[], statuses: ToolStatuses): AreaView[] {
  return areas.map((area) => {
    const visible = new Set(area.tools.map(toolRoute));
    const parts = area.headline.filter((href) => visible.has(href)).flatMap((href) => (statuses[href] ? [statuses[href]!] : []));
    return {
      slug: area.slug,
      name: area.name,
      href: areaHref(area.slug),
      icon: area.icon,
      description: area.description,
      line: parts,
      tools: area.tools.map((tool) => ({ ...tool, route: toolRoute(tool), status: statuses[toolRoute(tool)] ?? null })),
    };
  });
}
