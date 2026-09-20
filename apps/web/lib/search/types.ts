import type { ToolName } from "@/lib/ask/tools";

/**
 * The shape of one global-search result, and the two provider shapes that
 * produce them.
 *
 * WHY TWO PROVIDER SHAPES, NOT ONE FIELD CALLED `capability`. A hand-typed
 * `capability` field is exactly the "second list that will drift" the
 * founder's ask warned about — nothing would stop a provider from naming a
 * capability its own route disagrees with, and nothing would notice until a
 * result leaked. So there is no such field anywhere in this file. Instead:
 *
 *   - `RouteSearchProvider` names the STATIC route its record's list page
 *     lives at. `providerCapability()` in query.ts derives the gate from
 *     that route via `capabilityForRoute()` — the same function
 *     `lib/ask/appHelp.ts`'s `reachableWalkthroughs` already uses for the
 *     page half of this feature. A typo'd route cannot silently read as
 *     open: `searchProviderCensus.test.ts` holds every route to
 *     `lib/walkthroughs/census-helpers`'s page map, built from the
 *     filesystem.
 *   - `ToolSearchProvider` is for a record with no static list page of its
 *     own (change orders and invoices both live inside a job-detail
 *     section, not on a page `ROUTE_CAPABILITY` can key on). It borrows the
 *     capability ALREADY reviewed for the Ask tool that reads the exact
 *     same data, by name — never a fresh decision, and
 *     `searchProviderCensus.test.ts` fails if the named tool does not
 *     exist.
 *
 * Either way, the capability actually enforced at search time is read off
 * `lib/permissions.ts` or `lib/ask/tools.ts` at call time, never stored on
 * the provider. See `providerCapability()` in `./query.ts`.
 */

export type SearchRecordResult = {
  kind: "record";
  /** Matches the provider's own `type` — the group key in the UI and the
   * census. Lowercase, singular, e.g. "job", "rfi". */
  type: string;
  id: string;
  title: string;
  /** A second line of context — job name, GC, status. Never a money figure
   * unless the provider's own gate is a MANAGE_BILLING-class capability;
   * see each provider's own comment in providers.ts. */
  subtitle: string | null;
  href: string;
};

export type SearchPageResult = {
  kind: "page";
  route: string;
  title: string;
  href: string;
};

export type SearchResult = SearchRecordResult | SearchPageResult;

export type RecordSearchArgs = {
  companyId: string;
  /** The trimmed, original-case query, for `contains` matching. */
  query: string;
  /** Lowercased, whitespace-split, empty words dropped. Most providers only
   * need `query`; a couple use `terms` to also try a numeric match (an RFI
   * or invoice number). */
  terms: string[];
  /** At most this many rows back, per provider — the UI groups by type, so
   * a provider hogging the list would crowd out every other kind. */
  limit: number;
};

type BaseProvider = {
  /** Lowercase, singular, unique across the registry — the group key.
   * Checked for uniqueness by the census. */
  type: string;
  /** Plural, for the group heading in the UI, e.g. "Jobs". */
  label: string;
  search(args: RecordSearchArgs): Promise<SearchRecordResult[]>;
};

export type RouteSearchProvider = BaseProvider & {
  gate: "route";
  /** e.g. "/rfis". Must be a real static route — see the file comment. */
  route: string;
};

export type ToolSearchProvider = BaseProvider & {
  gate: "tool";
  /** The Ask tool that reads this exact data, cited by name so the census
   * can confirm it still exists in `lib/ask/tools.ts`'s TOOLS array. */
  toolName: ToolName;
};

export type SearchProvider = RouteSearchProvider | ToolSearchProvider;

/**
 * The group heading for each record type, in the order the UI lists
 * groups. Lives here — not in providers.ts, which imports `@prova/db` and
 * so can never be imported by a client component — so `SearchLauncher.tsx`
 * can render group headings without pulling Prisma into the browser
 * bundle. `providers.ts` reads its own `label` field off this same map,
 * so there is exactly one place that spells "Punch list", not two that
 * could drift apart.
 */
export const SEARCH_TYPE_LABELS: Record<string, string> = {
  job: "Jobs",
  contact: "Contacts",
  crew: "Team",
  vendor: "Vendors",
  rfi: "RFIs",
  submittal: "Submittals",
  punchListItem: "Punch list",
  drawing: "Drawings",
  changeOrder: "Change orders",
  invoice: "Invoices",
};
