import { TOOLS } from "@/lib/ask/tools";
import { reachableWalkthroughs, searchAppHelp } from "@/lib/ask/appHelp";
import { can, capabilityForRoute, type Capability, type Principal } from "@/lib/permissions";
import { SEARCH_PROVIDERS } from "./providers";
import type { SearchPageResult, SearchProvider, SearchRecordResult } from "./types";

/** Below this, a query is too short to mean anything and would just cost a
 * round trip and a wall of noise — "a" or "in" matches everything. */
const MIN_QUERY_LENGTH = 2;
/** Per record TYPE, not overall — so ten kinds each get a fair shot instead
 * of one prolific type (say, punch list items) crowding out every other
 * group. */
const RESULTS_PER_RECORD_TYPE = 6;
const PAGE_RESULTS = 6;

/**
 * THE security function in this feature. Reads the gate straight off
 * `lib/permissions.ts` (a route's capability) or `lib/ask/tools.ts` (an
 * existing tool's capability) — never off a field the provider declared
 * itself. See types.ts's file comment for why that split exists, and
 * `searchProviderCensus.test.ts` for what holds every provider to a real
 * source rather than a made-up one.
 *
 * Exported so both `globalSearch` below and the census can call the exact
 * function that will run at search time, rather than the census
 * re-implementing its own copy that could quietly drift from this one.
 */
export function providerCapability(provider: SearchProvider): Capability | null {
  if (provider.gate === "route") return capabilityForRoute(provider.route);
  const tool = TOOLS.find((t) => t.name === provider.toolName);
  if (!tool) {
    // A provider citing a tool name that no longer exists is a coding
    // error, not a permission question — fail loudly rather than silently
    // treating it as ungated (which `?? null` would do).
    throw new Error(`search provider "${provider.type}" cites unknown Ask tool "${provider.toolName}"`);
  }
  return tool.capability;
}

/** The providers this principal may search at all. Computed once per
 * request and reused for both the query terms and (in the census) for
 * auditing — a provider a person cannot reach is not merely filtered out
 * of the results, its `search()` is never called, so there is no
 * database round trip to leak from in the first place. */
export function allowedProviders(principal: Principal, providers: readonly SearchProvider[] = SEARCH_PROVIDERS): SearchProvider[] {
  return providers.filter((provider) => {
    const needed = providerCapability(provider);
    return needed === null || can(principal, needed);
  });
}

/**
 * Whether a walkthrough's route is a URL a person can actually be sent to.
 *
 * A walkthrough's `route` is a Next.js route PATTERN, not a URL. Six of the
 * registry's entries are job-detail tabs registered as `/jobs/[id]` and
 * `/jobs/[id]/{billing,crew,estimate,field-reports,photos}`, and the page
 * half of `globalSearch` handed the pattern straight to `href`.
 * `router.push` percent-encodes the brackets, so searching "billing" or
 * "estimate" offered a Pages result that navigated to
 * `/jobs/%5Bid%5D/billing` — "This page doesn't exist." Found by the first
 * pilot contractor, in his first session, on #386.
 *
 * WHY THESE ARE EXCLUDED RATHER THAN RESOLVED. The obvious alternative is
 * to point them at `/jobs`, since their titles already read "A job —
 * billing". Rejected on two grounds. There is no correct id to fill in —
 * the query says nothing about WHICH job, and picking one (the most
 * recently updated, say) would make the same search mean different things
 * to different people and put a record in front of someone who never asked
 * for it. And landing on the jobs list does not deliver billing: it trades
 * a fast, obvious 404 for a slow, silent dead end, which is harder to
 * report rather than better.
 *
 * IT ALSO CLOSES A CAPABILITY HOLE, which is the half nobody reported.
 * `reachableWalkthroughs` filters pages through `capabilityForRoute`,
 * which reads `ROUTE_CAPABILITY` — a map keyed on STATIC hrefs, as its own
 * comment in `lib/ask/appHelp.ts` notes. A dynamic route is absent from it,
 * so it resolves to null, which means "open". Measured on `origin/main`
 * before this change: a FIELD member searching "billing" or "estimate" was
 * offered exactly what an OWNER was, while every other page result did
 * differ by role. Those six entries were the only ones in the index
 * bypassing the capability filter, and they are the six that could not be
 * opened anyway.
 *
 * WHAT IT COSTS, stated rather than buried: "billing" and "estimate" now
 * return no Pages result at all, because this app has no static billing or
 * estimate page — both live inside a job. That is the honest answer to a
 * search, and the fix for it is a page, not a link to a page shape.
 *
 * `searchPageCensus.test.ts` pins this to the walkthrough registry and to
 * the page files on disk, so it cannot pass by matching nothing.
 */
export function isOpenableRoute(route: string): boolean {
  return !/\[[^\]]*\]/.test(route);
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export type GlobalSearchResponse = {
  records: SearchRecordResult[];
  pages: SearchPageResult[];
};

const EMPTY_RESPONSE: GlobalSearchResponse = { records: [], pages: [] };

/**
 * The whole feature, minus the transport (see lib/actions/search.ts). Two
 * halves that never touch: records come from `SEARCH_PROVIDERS`, already
 * filtered to what this person may reach; pages come from the SAME
 * capability-filtered walkthrough registry `lib/ask/appHelp.ts`'s
 * `app_help` Ask tool already searches — reused rather than re-described,
 * per the founder's ask.
 */
export async function globalSearch(
  args: {
    companyId: string;
    principal: Principal;
    query: string;
  },
  // Overridable for tests only, the same shape `reachableWalkthroughs` and
  // `searchAppHelp` already use — production always takes the default.
  registryProviders: readonly SearchProvider[] = SEARCH_PROVIDERS,
): Promise<GlobalSearchResponse> {
  const query = args.query.trim();
  if (query.length < MIN_QUERY_LENGTH) return EMPTY_RESPONSE;

  const terms = queryTerms(query);
  const providers = allowedProviders(args.principal, registryProviders);

  const [recordsByProvider, reachableForHelp] = await Promise.all([
    Promise.all(
      providers.map((provider) =>
        provider.search({ companyId: args.companyId, query, terms, limit: RESULTS_PER_RECORD_TYPE }),
      ),
    ),
    Promise.resolve(reachableWalkthroughs(args.principal)),
  ]);

  // Filtered BEFORE the slice, not after: six unopenable entries taken off
  // the top would otherwise spend the six-result budget on nothing and
  // hide the real pages underneath them.
  const pageMatches = searchAppHelp(query, reachableForHelp)
    .filter((match) => isOpenableRoute(match.route))
    .slice(0, PAGE_RESULTS);
  const pages: SearchPageResult[] = pageMatches.map((match) => ({
    kind: "page",
    route: match.route,
    title: match.title,
    href: match.route,
  }));

  return { records: recordsByProvider.flat(), pages };
}
