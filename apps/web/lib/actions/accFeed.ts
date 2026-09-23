"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { AccApiError, AccForbiddenError } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AccNotConfiguredError, AccNotConnectedError, AccReconnectError } from "@/lib/acc/connection";
import { isStale, refreshAccLink } from "@/lib/acc/feed";
import { type ActionResultWith } from "./shared";

/**
 * "Refresh from ACC" on /rfis and /submittals, and the same thing run
 * quietly when one of those pages opens with a stale cache. Same shape as
 * lib/actions/procoreFeed.ts — read that file's header first.
 *
 * Its own module, apart from lib/actions/acc.ts, because it is reached from
 * a different door: these two pages demand MANAGE_JOBS, the Integrations
 * page MANAGE_COMPLIANCE, and an action is held to the capability of the
 * pages that reach it (action-capability-guards.test.ts).
 *
 * NOT owner-only, deliberately, for the same reason as Procore's: it reads
 * the GC's project with the connection the OWNER made, writes only this
 * company's cache of it, and changes nothing in ACC or in this company's
 * own records — it is the same as reloading.
 *
 * Scoped to the SESSION's company: the job id from the page is only a
 * filter within it.
 */

const NOT_YOUR_FUNCTION = "Jobs aren't part of your job function. Ask the account owner.";

/** At most this many projects per call, so one press cannot run a Server
 * Action past its time limit or spend a big share of Autodesk's rate limit
 * in one go. The rest refresh on the next open. */
const REFRESH_LINKS_PER_CALL = 5;

export type AccRefreshSummary = { refreshed: number; failed: number; skipped: number };

export async function refreshAccFeed(jobId: unknown, onlyStale: unknown): Promise<ActionResultWith<AccRefreshSummary>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return { ok: false, error: NOT_YOUR_FUNCTION };
  const companyId = context.company.id;

  const links = await prisma.accProjectLink.findMany({
    where: { companyId, ...(typeof jobId === "string" && jobId ? { jobId } : {}) },
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
    select: { id: true, lastRefreshedAt: true },
  });
  const now = new Date();
  const due = onlyStale === true ? links.filter((link) => isStale(link.lastRefreshedAt, now)) : links;
  const batch = due.slice(0, REFRESH_LINKS_PER_CALL);

  let refreshed = 0;
  let failed = 0;
  for (const link of batch) {
    try {
      const outcome = await refreshAccLink(companyId, link.id);
      if (outcome?.ok) refreshed += 1;
      else failed += 1;
    } catch (error) {
      if (error instanceof AccNotConnectedError || error instanceof AccReconnectError || error instanceof AccNotConfiguredError) {
        // Every other link would fail the same way — say it once.
        return { ok: false, error: error.message };
      }
      if (error instanceof AccApiError || error instanceof AccForbiddenError) {
        failed += 1;
        await prisma.accProjectLink.updateMany({
          where: { id: link.id, companyId },
          data: { lastRefreshedAt: now, lastRefreshStatus: "FAILURE", lastRefreshMessage: error.message },
        });
        continue;
      }
      throw error;
    }
  }

  if (batch.length > 0) {
    revalidatePath("/rfis");
    revalidatePath("/submittals");
  }
  return { ok: true, value: { refreshed, failed, skipped: due.length - batch.length } };
}
