"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { ProcoreApiError, ProcoreForbiddenError } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  ProcoreNotConfiguredError,
  ProcoreNotConnectedError,
  ProcoreReconnectError,
} from "@/lib/procore/connection";
import { isStale, refreshProcoreLink } from "@/lib/procore/feed";
import { type ActionResultWith } from "./shared";

/**
 * "Refresh from Procore" on /rfis, /submittals and /drawings, and the same
 * thing run quietly when one of those pages opens with a stale cache.
 *
 * Its own module, apart from lib/actions/procore.ts, because it is reached
 * from a different door: these three pages demand MANAGE_JOBS, the
 * Integrations page MANAGE_COMPLIANCE, and an action is held to the
 * capability of the pages that reach it (action-capability-guards.test.ts).
 *
 * NOT owner-only, deliberately. It reads the GC's project with the
 * connection the OWNER made, writes only this company's cache of it, and
 * changes nothing in Procore or in this company's own records — it is the
 * same as reloading. Linking and connecting are the owner's decisions and
 * stay on the Integrations page.
 *
 * Scoped to the SESSION's company: the job id from the page is only a
 * filter within it.
 */

const NOT_YOUR_FUNCTION = "Jobs aren't part of your job function. Ask the account owner.";

/** At most this many projects per call, so one press cannot run a Server
 * Action past its time limit or spend a big share of Procore's hourly
 * allowance in one go. The rest refresh on the next open. */
const REFRESH_LINKS_PER_CALL = 5;

export type ProcoreRefreshSummary = { refreshed: number; failed: number; skipped: number };

export async function refreshProcoreFeed(
  jobId: unknown,
  onlyStale: unknown,
): Promise<ActionResultWith<ProcoreRefreshSummary>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return { ok: false, error: NOT_YOUR_FUNCTION };
  const companyId = context.company.id;

  const links = await prisma.procoreProjectLink.findMany({
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
      const outcome = await refreshProcoreLink(companyId, link.id);
      if (outcome?.ok) refreshed += 1;
      else failed += 1;
    } catch (error) {
      if (
        error instanceof ProcoreNotConnectedError ||
        error instanceof ProcoreReconnectError ||
        error instanceof ProcoreNotConfiguredError
      ) {
        // Every other link would fail the same way — say it once.
        return { ok: false, error: error.message };
      }
      if (error instanceof ProcoreApiError || error instanceof ProcoreForbiddenError) {
        failed += 1;
        await prisma.procoreProjectLink.updateMany({
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
    revalidatePath("/drawings");
  }
  return { ok: true, value: { refreshed, failed, skipped: due.length - batch.length } };
}
