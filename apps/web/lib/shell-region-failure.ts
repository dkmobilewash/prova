import type { ShellRegionName } from "@/components/ShellRegion";

/**
 * The server-side half of `components/ShellRegion.tsx`.
 *
 * A shell region can fail two ways: its component throws while RENDERING,
 * which the client boundary in ShellRegion catches — or the QUERY that
 * feeds it throws in `app/(app)/layout.tsx`, before any component exists to
 * be caught. The layout awaits the money figures in one `Promise.all`, so a
 * `getMoneyRailStages` that chokes on one strange invoice rejects the whole
 * layout and every page with it, exactly as a render throw did on
 * 2026-09-21. Same failure, one level earlier.
 *
 * So each region's query is settled with this: log the failure in the same
 * `[shell]` shape the client boundary uses, and hand back the region's
 * "nothing to show" value — `[]` for the rail, which already means "no
 * figures" for a principal without VIEW_COMPANY_FINANCIALS, or `null` for
 * the metric bar, which the layout turns into the region's fallback.
 *
 * NOT for the alert count or `requireCompanyContext`. Those are not
 * decoration: a wrong alert badge is a claim about the person's records, and
 * no company context means no page at all. Only the two money regions, whose
 * absence costs an inconvenience rather than a fact.
 *
 * Lives in `lib/` rather than in ShellRegion.tsx because that file is
 * `"use client"`: a function exported from a client module becomes a client
 * reference when a server component imports it, and cannot be called there.
 */
export function shellQueryFailed<T>(region: ShellRegionName, fallback: T): (error: unknown) => T {
  return (error) => {
    console.error(
      `[shell] ${region} query failed and its region was replaced by its fallback; the page is unaffected.`,
      error,
    );
    return fallback;
  };
}
