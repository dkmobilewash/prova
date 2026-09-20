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

  const pageMatches = searchAppHelp(query, reachableForHelp).slice(0, PAGE_RESULTS);
  const pages: SearchPageResult[] = pageMatches.map((match) => ({
    kind: "page",
    route: match.route,
    title: match.title,
    href: match.route,
  }));

  return { records: recordsByProvider.flat(), pages };
}
