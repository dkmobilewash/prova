import type { NavGroup } from "@/components/navItems";

/**
 * The words in the Concept G top bar (Jobs · Money · Schedule · AI) and the
 * tabs on a phone (Home · Jobs · Money · Schedule · AI).
 *
 * AI joined 2026-10-11 (the AI agents build, mockups ai-home-desktop.png and
 * ai-home-phone.png). Only for someone who can open /ai — MANAGE_ESTIMATING,
 * read off the same filtered nav list as every other word. Five tabs fit a
 * 390px phone: 74px each against a 64px icon pill and a 58.8px "Schedule",
 * measured in Chromium (see BottomTabs.tsx).
 *
 * Derived from the SAME filtered list the "All pages" panel draws —
 * `navGroupsFor()` in navItems.tsx — so a word can only point at a page this
 * person may open and this company's answers have not hidden. A tab whose
 * page is not in that list is dropped, never drawn as a door that refuses.
 *
 * Pure, so primaryNav.test.ts can pin it without a DOM.
 */
export type PrimaryTabKey = "home" | "jobs" | "money" | "schedule" | "ai";
export type PrimaryTab = { key: PrimaryTabKey; label: string; href: string };

/** Where "Money" goes, best first. Cash flow is the company's money in one
 * page; WIP is the fallback for someone who can see company figures but not
 * cash flow; backcharges and lien deadlines are what a billing person
 * without company figures can still open. */
export const MONEY_CANDIDATES = ["/cash-flow", "/wip", "/backcharges", "/lien-deadlines"] as const;

/** Pages that light "Money" — the Financials group, cash flow, and the
 * Money area page the word opens. */
const MONEY_PAGES = ["/areas/money", "/cash-flow", "/wip", "/phase-codes", "/backcharges", "/lien-deadlines"];

/** The Money area (lib/areas.ts). Spelled out rather than imported so this
 * file stays free of the nav icons; primaryNav.test.ts pins it to
 * areaHref("money"). */
export const MONEY_AREA_HREF = "/areas/money";

/** The jobs list lives on the dashboard (`/jobs` redirects there), so Jobs
 * points at the dashboard's jobs section. `#jobs` is the anchor the home
 * page puts on its "Your jobs" block; without it the link still lands on
 * the dashboard, which is where the list is. */
export const JOBS_HREF = "/dashboard#jobs";

/** The AI home. Its sub-pages (/ai/activity, /ai/bids/[id]) light it too. */
export const AI_HREF = "/ai";

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function primaryTabs(groups: NavGroup[]): PrimaryTab[] {
  const visible = new Set(groups.flatMap((g) => g.items.filter((i) => !i.disabled).map((i) => i.href)));
  const tabs: PrimaryTab[] = [];
  if (visible.has("/dashboard")) {
    tabs.push({ key: "home", label: "Home", href: "/dashboard" });
    tabs.push({ key: "jobs", label: "Jobs", href: JOBS_HREF });
  }
  // Money opens the Money AREA (Concept H) — every money page as a card,
  // plus what is overdue — whenever this person can open any of the pages
  // in it. The area page filters by the same capabilities (lib/areas.ts).
  if (MONEY_CANDIDATES.some((href) => visible.has(href))) {
    tabs.push({ key: "money", label: "Money", href: MONEY_AREA_HREF });
  }
  if (visible.has("/schedule")) tabs.push({ key: "schedule", label: "Schedule", href: "/schedule" });
  if (visible.has(AI_HREF)) tabs.push({ key: "ai", label: "AI", href: AI_HREF });
  return tabs;
}

/**
 * Which tab the current page belongs to. `hasHome` is false on the desktop
 * bar, which has no Home word (the wordmark is the way home) — there the
 * dashboard lights NOTHING. It used to light Jobs, because Jobs links to
 * `/dashboard#jobs`, and then home and Jobs read as one tab (click test,
 * 2026-10-11). Jobs is lit on a job and on the Jobs & bids area.
 */
export function activeTab(pathname: string, hasHome: boolean): PrimaryTabKey | null {
  if (pathname === "/dashboard") return hasHome ? "home" : null;
  if (under(pathname, "/jobs") || under(pathname, "/areas/jobs-bids")) return "jobs";
  if (MONEY_PAGES.some((p) => under(pathname, p))) return "money";
  if (under(pathname, "/schedule")) return "schedule";
  if (under(pathname, AI_HREF)) return "ai";
  return null;
}

/** Two letters for the avatar: first and last word of the name, else the
 * first two letters of the email, else "?". */
export function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const local = (email ?? "").split("@")[0];
  return local ? local.slice(0, 2).toUpperCase() : "?";
}
