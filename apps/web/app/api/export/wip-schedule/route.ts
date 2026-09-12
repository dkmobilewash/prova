import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { exportFilename } from "@/lib/export";
import { loadWipSchedule } from "@/lib/wip-schedule-query";
import { wipScheduleCsv } from "@/lib/wip-schedule";

/**
 * The WIP schedule, as the file a surety underwriter or a CPA asked for.
 *
 * A Route Handler rather than a Server Action for the same reason
 * /api/export is one: this returns a FILE. A Server Action returns a value
 * to the component that called it; a download needs a Response with its own
 * content type and Content-Disposition.
 *
 * IT SITS UNDER /api/export DELIBERATELY. `middleware.ts` protects
 * `/api/export(.*)`, so this path is already inside the allowlist a reader
 * checks — no middleware change was needed and none was made. It reuses that
 * subsystem's CSV writer, its escaping and its filename helper rather than
 * growing a second export mechanism beside it.
 *
 * IT IS NOT IN THE DATASET REGISTRY, and could not be. `EXPORT_DATASETS` is
 * a table dump: each entry names a Prisma delegate, an allowlist of that
 * model's columns, and a `where` that scopes them to a company. A WIP
 * schedule is none of those things — it is DERIVED, one row per job from
 * four models and two pure calculation modules, and there is no column on
 * any table called "costs in excess of billings". Forcing it into the
 * registry would mean either inventing a fake delegate or loosening the
 * registry's shape, and that shape is the security of the whole feature: the
 * allowlist is what stops a newly added credential column leaking. So this
 * is a sibling of the registry, not a member of it.
 *
 * THE GATE IS CAPABILITY-BASED, NOT OWNER-ONLY, AND THAT IS A DECISION.
 *
 * /api/export is OWNER-only because one file holding every job, every price
 * and every employee's hours is a different object from any single page.
 * This file is not that object: it is one derived table of job financials,
 * with no hours, no rates, no contact details and no line items.
 *
 * It requires BOTH `VIEW_COMPANY_FINANCIALS` (it aggregates the whole book
 * — the same capability `/cash-flow` and the metric bar already take) and
 * `VIEW_JOB_COSTS` (every row is one job's cost and margin). Both, rather
 * than either, because the file genuinely contains both kinds of fact, and
 * naming both means a future change to one job function's list moves this
 * gate with it rather than around it.
 *
 * Today those two sets coincide — OWNER, EXECUTIVE, ACCOUNTING and a member
 * with no job function set hold both; ESTIMATOR and PROJECT_MANAGER hold
 * VIEW_JOB_COSTS without VIEW_COMPANY_FINANCIALS, and FIELD holds neither.
 * The case that decided it against OWNER-only is ACCOUNTING: the WIP
 * schedule is the bookkeeper's and the CPA's document, and an owner-only
 * gate would lock out the one job function that exists to produce it, on a
 * page (`/cash-flow`) that function can already open.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  // One session read, two questions of it. requireCapability is the
  // boundary and answers the first; `can` answers the second against the
  // same context rather than resolving the session a second time.
  const { context, allowed } = await requireCapability("VIEW_COMPANY_FINANCIALS");

  if (!allowed || !can(context, "VIEW_JOB_COSTS")) {
    // Plain text rather than a redirect: this URL is hit by a download, and
    // a redirect would silently save the sign-in page as a .csv file. The
    // same reasoning, and the same shape, as /api/export's 403.
    return new NextResponse(
      "A WIP schedule is company-wide job cost and margin, so it needs both company-financials and job-cost access. Ask the account owner to change your job function on the team page.",
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Scoped from the signed-in session's own company, never from anything a
  // caller can set: "which company is this export for" is the question a
  // data export must never get wrong.
  const schedule = await loadWipSchedule(context.company.id);

  return new NextResponse(wipScheduleCsv(schedule), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename("wip-schedule", new Date(), "csv")}"`,
    },
  });
}
