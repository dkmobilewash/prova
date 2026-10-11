import type { NavGroup } from "@/components/navItems";

/**
 * The three words in the Concept G top bar (Jobs · Money · Schedule) and the
 * four tabs on a phone (Home · Jobs · Money · Schedule).
 *
 * Derived from the SAME filtered list the "All pages" panel draws —
 * `navGroupsFor()` in navItems.tsx — so a word can only point at a page this
 * person may open and this company's answers have not hidden. A tab whose
 * page is not in that list is dropped, never drawn as a door that refuses.
 *
 * Pure, so primaryNav.test.ts can pin it without a DOM.
 */
export type PrimaryTabKey = "home" | "jobs" | "money" | "schedule";
export type PrimaryTab = { key: PrimaryTabKey; label: string; href: string };

/** Where "Money" goes, best first. Cash flow is the company's money in one
 * page; WIP is the fallback for someone who can see company figures but not
 * cash flow; backcharges and lien deadlines are what a billing person
 * without company figures can still open. */
export const MONEY_CANDIDATES = ["/cash-flow", "/wip", "/backcharges", "/lien-deadlines"] as const;

/** Pages that light "Money" — the Financials group plus cash flow. */
const MONEY_PAGES = ["/cash-flow", "/wip", "/phase-codes", "/backcharges", "/lien-deadlines"];

/** The jobs list lives on the dashboard (`/jobs` redirects there), so Jobs
 * points at the dashboard's jobs section. `#jobs` is the anchor the home
 * page puts on its "Your jobs" block; without it the link still lands on
 * the dashboard, which is where the list is. */
export const JOBS_HREF = "/dashboard#jobs";

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
  const money = MONEY_CANDIDATES.find((href) => visible.has(href));
  if (money) tabs.push({ key: "money", label: "Money", href: money });
  if (visible.has("/schedule")) tabs.push({ key: "schedule", label: "Schedule", href: "/schedule" });
  return tabs;
}

/**
 * Which tab the current page belongs to. `hasHome` is false on the desktop
 * bar, which has no Home word (the wordmark is the way home) — there the
 * dashboard lights Jobs, since the jobs list is what it holds.
 */
export function activeTab(pathname: string, hasHome: boolean): PrimaryTabKey | null {
  if (pathname === "/dashboard") return hasHome ? "home" : "jobs";
  if (under(pathname, "/jobs")) return "jobs";
  if (MONEY_PAGES.some((p) => under(pathname, p))) return "money";
  if (under(pathname, "/schedule")) return "schedule";
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
