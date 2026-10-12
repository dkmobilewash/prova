import { can, canReach, type Capability, type Principal } from "@/lib/permissions";
import type { SearchPageResult, SearchRecordResult } from "./types";

/** What GET /api/search answers. `NavPage` is spelled here rather than
 * imported from query.ts, which pulls in `@prova/db`. */
/** Said when search itself could not run — deliberately not "no results",
 * which is a different and much more misleading claim. */
export const SEARCH_UNAVAILABLE = "Search could not run just now. Try again in a moment.";

export type PaletteResponse = {
  records: SearchRecordResult[];
  pages: SearchPageResult[];
  recentJobs: SearchRecordResult[];
  actions: PaletteAction[];
  navPages: { href: string; label: string; group: string }[];
};

/** The palette's group for each record type — the mockup's five headings,
 * not one heading per table. */
export const PALETTE_GROUP: Record<string, "Jobs" | "People" | "Documents"> = {
  job: "Jobs",
  contact: "People",
  crew: "People",
  vendor: "People",
  rfi: "Documents",
  submittal: "Documents",
  invoice: "Documents",
  changeOrder: "Documents",
  drawing: "Documents",
  punchListItem: "Documents",
};

/**
 * The palette's static half: shortcut actions, and the pure helpers the
 * client uses to filter and highlight. Imports no `@prova/db`, so
 * `components/shell/CommandPalette.tsx` may import the helpers below.
 *
 * WHY "LOG HOURS" AND "SEND PAY APP" HAVE NO HREF. Both happen inside one
 * job (`/jobs/[id]/crew`, `/jobs/[id]/billing`) and there is no page that
 * does them without one. Linking to a guessed job — the most recent, say —
 * would send someone to log hours on the wrong job. So choosing either one
 * asks "which job?" and the job results that follow open that job's tab.
 */
export type PaletteAction = {
  id: string;
  label: string;
  hint: string;
  /** A static route to open, OR — */
  href?: string;
  /** — the job tab to open once a job is picked. */
  jobTab?: "crew" | "billing";
};

type ActionDef = PaletteAction & {
  /** For a `jobTab` action: the capability that tab's own page withholds
   * on (`jobCapabilities` in lib/jobs/job-access.ts). For an `href`
   * action this is unused — the gate is read off the route itself via
   * `canReach`, so it cannot disagree with ROUTE_CAPABILITY. */
  capability?: Capability;
};

const ACTIONS: ActionDef[] = [
  { id: "new-job", label: "New job", hint: "Start a job or an estimate", href: "/jobs/new" },
  { id: "log-bid", label: "Log a bid", hint: "A bid invitation from a GC", href: "/bids?new=1" },
  { id: "log-hours", label: "Log hours", hint: "Pick a job, then log the crew's time", jobTab: "crew", capability: "MANAGE_FIELD" },
  { id: "send-pay-app", label: "Send pay app", hint: "Pick a job, then bill it", jobTab: "billing", capability: "MANAGE_BILLING" },
  { id: "find-rfi", label: "Find an RFI", hint: "Every RFI, open and answered", href: "/rfis" },
];

/** The shortcut actions this person can actually carry out. */
export function actionsFor(principal: Principal): PaletteAction[] {
  return ACTIONS.filter((a) => (a.href ? canReach(principal, a.href) : a.capability ? can(principal, a.capability) : true)).map(
    ({ id, label, hint, href, jobTab }) => ({ id, label, hint, href, jobTab }),
  );
}

/** Case-insensitive "does every word of the query appear in this text". */
export function matches(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/**
 * Splits `text` into runs, marking the ones that match a query word, so the
 * palette can render the match in the link colour. Case-insensitive; the
 * returned text keeps the original case.
 */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [{ text, hit: false }];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return text
    .split(re)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, hit: words.some((w) => w.toLowerCase() === part.toLowerCase()) }));
}

const QUESTION_START =
  /^(what|whats|what's|who|whose|when|where|which|why|how|is|are|was|were|do|does|did|can|could|should|will|would|has|have|show|list|bill|log|send|create|make|add|draft|tell|give|find|summari[sz]e|remind)\b/i;

/**
 * Whether a query reads as a question or a command rather than a name —
 * "bill Northgate for October", "who is on Harbor today?". A name lookup
 * ("northgate") must not grow an Ask row, or every search offers the AI.
 *
 * ponytail: word-list heuristic; it under-offers on oddly phrased questions,
 * which only costs the row, never a wrong answer.
 */
export function looksLikeAsk(query: string): boolean {
  const q = query.trim();
  if (q.length < 3) return false;
  if (q.endsWith("?")) return true;
  return QUESTION_START.test(q) && q.split(/\s+/).length >= 2;
}

export type PaletteEntry = {
  id: string;
  title: string;
  subtitle: string | null;
  /** Where choosing it goes. Absent only for a job-picking action, which
   * opens a second step instead of a page. */
  href?: string;
  pick?: PaletteAction;
  verb: string;
  icon: "job" | "person" | "doc" | "action" | "page" | "ask";
};

export type PaletteSection = { heading: string; entries: PaletteEntry[] };

const PAGES_WHEN_TYPING = 6;
const ACTIONS_WHEN_TYPING = 4;

const recordEntry = (r: SearchRecordResult, jobTab?: string): PaletteEntry => {
  const group = PALETTE_GROUP[r.type];
  return {
    id: `${r.type}:${r.id}`,
    title: r.title,
    subtitle: r.subtitle,
    href: jobTab ? `${r.href}/${jobTab}` : r.href,
    verb: group === "Documents" ? "View" : "Open",
    icon: group === "Jobs" ? "job" : group === "People" ? "person" : "doc",
  };
};

/**
 * What the palette lists, as data — so the grouping is tested without a
 * DOM. Three states:
 *
 *  - picking a job for "Log hours" / "Send pay app": jobs only, each one
 *    opening that job's tab;
 *  - nothing typed: recent jobs, the shortcut actions, every page;
 *  - typed: Jobs / People / Documents from the server, Actions and Pages
 *    matched here, and — when it reads like a question — one row that
 *    hands the words to Ask.
 */
export function buildSections(data: PaletteResponse | null, rawQuery: string, pending: PaletteAction | null): PaletteSection[] {
  if (!data) return [];
  const query = rawQuery.trim();
  const typed = query.length >= 2;
  const out: PaletteSection[] = [];
  const push = (heading: string, entries: PaletteEntry[]) => {
    if (entries.length > 0) out.push({ heading, entries });
  };

  if (pending) {
    const jobs = typed ? data.records.filter((r) => r.type === "job") : data.recentJobs;
    push(
      typed ? "Jobs" : "Recent jobs",
      jobs.map((r) => ({ ...recordEntry(r, pending.jobTab), verb: pending.label })),
    );
    return out;
  }

  const actionEntry = (a: PaletteAction): PaletteEntry => ({
    id: `action:${a.id}`,
    title: a.label,
    subtitle: a.hint,
    href: a.href,
    pick: a.jobTab ? a : undefined,
    verb: "Do it",
    icon: "action",
  });
  const pageEntry = (p: { href: string; label: string; group: string }): PaletteEntry => ({
    id: `page:${p.href}`,
    title: p.label,
    subtitle: p.group,
    href: p.href,
    verb: "Go",
    icon: "page",
  });

  if (!typed) {
    push("Recent jobs", data.recentJobs.map((r) => recordEntry(r)));
    push("Actions", data.actions.map(actionEntry));
    push("All pages", data.navPages.map(pageEntry));
    return out;
  }

  for (const heading of ["Jobs", "People", "Documents"] as const) {
    push(
      heading,
      data.records.filter((r) => PALETTE_GROUP[r.type] === heading).map((r) => recordEntry(r)),
    );
  }
  push(
    "Actions",
    data.actions.filter((a) => matches(a.label, query)).slice(0, ACTIONS_WHEN_TYPING).map(actionEntry),
  );

  // Nav labels first (the doors the sidebar had), then the walkthrough
  // matches `globalSearch` found by description — never the same href twice.
  const seen = new Set<string>();
  const pages = [
    ...data.navPages.filter((p) => matches(`${p.label} ${p.group}`, query)).map(pageEntry),
    ...data.pages.map((p) => pageEntry({ href: p.href, label: p.title, group: "Page" })),
  ].filter((e) => {
    if (seen.has(e.href!)) return false;
    seen.add(e.href!);
    return true;
  });
  push("Pages", pages.slice(0, PAGES_WHEN_TYPING));

  // Only when the assistant's own page is one this person can open.
  if (looksLikeAsk(query) && data.navPages.some((p) => p.href === "/ask")) {
    push("Ask", [
      {
        id: "ask",
        title: `Ask C Stream: ${query}`,
        subtitle: "Opens the assistant with this filled in — nothing runs until you press Ask",
        href: `/ask?q=${encodeURIComponent(query)}`,
        verb: "Ask",
        icon: "ask",
      },
    ]);
  }
  return out;
}
