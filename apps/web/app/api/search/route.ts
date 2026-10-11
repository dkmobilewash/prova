import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import type { Principal } from "@/lib/permissions";
import { globalSearch, navPagesFor } from "@/lib/search/query";
import { recentJobs } from "@/lib/search/providers";
import { actionsFor } from "@/lib/search/palette";

export const dynamic = "force-dynamic";

/**
 * The command palette's transport. A GET route rather than the existing
 * `searchApp` Server Action because the palette searches AS YOU TYPE, and
 * Next queues Server Actions one at a time per client: a slow query for
 * "no" would hold "north" behind it. A fetch can be aborted the moment the
 * next keystroke lands.
 *
 * Everything that decides WHAT comes back is lib/search — `globalSearch`
 * (company-scoped, capability-gated providers), `recentJobs`,
 * `navPagesFor` and `actionsFor`. `companyId` and `principal` come ONLY
 * from the session; the query string has no field for either.
 *
 * Answers 401 for no session rather than redirecting: a redirect to
 * /sign-in would hand the palette an HTML page to parse.
 */
export async function GET(request: Request) {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const principal: Principal = { role: context.role, jobFunction: context.jobFunction };
  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200).trim();
  const showsInternal = context.company.isProvaOperator && context.role === "OWNER";

  try {
    const [found, recent] = await Promise.all([
      globalSearch({ companyId: context.companyId, principal, query }),
      query.length === 0 ? recentJobs(context.companyId) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      records: found.records,
      pages: found.pages,
      recentJobs: recent,
      actions: actionsFor(principal),
      navPages: navPagesFor(principal, { showsInternal }),
    });
  } catch (error) {
    // Logged, not returned — a thrown message can name a column or a host.
    console.error("[search] /api/search failed", error);
    return NextResponse.json({ error: "Search could not run just now. Try again in a moment." }, { status: 500 });
  }
}
