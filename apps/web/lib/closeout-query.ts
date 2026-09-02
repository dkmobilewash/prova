import { prisma } from "@prova/db";
import {
  closeoutReadiness,
  type CloseoutReadiness,
} from "@/lib/closeout-readiness";
import {
  isOpen,
  outstandingRequired,
  requiredItems,
  type CloseoutItemData,
  type ServiceRequestData,
  type WarrantyPeriodData,
} from "@/components/closeoutLabels";
import type { CloseoutSubmissionData } from "@/components/CloseoutPackagePanel";
import { calculateRetainageSummary } from "@/lib/retainage";

/**
 * The closeout page's data, assembled and judged.
 *
 * Extracted from the page itself. It was composed inline there, which
 * meant the one thing worth proving — that readiness actually READS the
 * punch rows, the retainage and the latest submission, rather than
 * getting hand-built inputs — could not be executed by any test. The
 * unit suite covered `closeoutReadiness` with inputs a test wrote, and
 * nothing covered the step that produces those inputs from the database.
 *
 * That gap is exactly where this feature's headline claim lives: an open
 * punch item must hold closeout open even when "punch list sign-off" is
 * ticked. Fetch here, decide in lib/closeout-readiness.ts — the same
 * split renewals.ts/compliance-expiry.ts and alerts-query.ts/alerts.ts
 * already use, and the reason those halves are testable.
 */

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export type CloseoutJobRow = {
  id: string;
  name: string;
  items: CloseoutItemData[];
  warranty: WarrantyPeriodData | null;
  requests: ServiceRequestData[];
  submissions: CloseoutSubmissionData[];
  openPunchItems: number;
  retainageBalance: number;
  readiness: CloseoutReadiness;
};

export async function loadCloseoutJobs(
  companyId: string,
  todayIso: string,
): Promise<CloseoutJobRow[]> {
  const jobs = await prisma.job.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      closeoutItems: { orderBy: [{ isRequired: "desc" }, { name: "asc" }] },
      warrantyPeriod: true,
      warrantyServiceRequests: { orderBy: { reportedOn: "desc" } },

      // Read, never written, here. Punch items belong to /punch-lists and
      // retainage to the billing lane; readiness only needs to know they
      // exist, and an open punch item holds closeout open whether or not
      // anyone ticked "punch list sign-off".
      punchListItems: { where: { isDone: false }, select: { id: true } },
      invoices: { select: { retainageWithheld: true } },
      retainageReleases: { select: { amount: true } },
      substantialCompletionDate: true,

      closeoutSubmissions: {
        orderBy: { attempt: "desc" },
        include: { submittedByUser: { select: { name: true } } },
      },
    },
  });

  return jobs.map((job) => {
    const items: CloseoutItemData[] = job.closeoutItems.map((i) => ({
      id: i.id,
      name: i.name,
      isRequired: i.isRequired,
      completedOn: isoDate(i.completedOn),
      note: i.note,
      documentUrl: i.documentUrl,
      documentName: i.documentName,
    }));

    const requests: ServiceRequestData[] = job.warrantyServiceRequests.map((r) => ({
      id: r.id,
      reportedOn: isoDate(r.reportedOn) as string,
      description: r.description,
      reportedBy: r.reportedBy,
      responsibility: r.responsibility,
      resolvedOn: isoDate(r.resolvedOn),
      resolutionNote: r.resolutionNote,
    }));

    const submissions: CloseoutSubmissionData[] = job.closeoutSubmissions.map((s) => ({
      id: s.id,
      attempt: s.attempt,
      submittedOn: isoDate(s.submittedOn) as string,
      method: s.method,
      status: s.status as string,
      respondedOn: isoDate(s.respondedOn),
      gcResponse: s.gcResponse,
      note: s.note,
      submittedByName: s.submittedByUser?.name ?? null,
    }));

    // Withheld minus released, through the one implementation of that sum
    // — recomputing it here would be a second copy free to disagree with
    // /cash-flow and the metric bar.
    const retainageBalance = calculateRetainageSummary({
      invoiceRetainageWithheld: job.invoices.map((i) =>
        i.retainageWithheld != null ? Number(i.retainageWithheld) : null,
      ),
      releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
      substantialCompletionDate: job.substantialCompletionDate,
    }).balance;

    const openPunchItems = job.punchListItems.length;

    return {
      id: job.id,
      name: job.name,
      items,
      warranty: job.warrantyPeriod
        ? {
            startsOn: isoDate(job.warrantyPeriod.startsOn) as string,
            months: job.warrantyPeriod.months,
            note: job.warrantyPeriod.note,
          }
        : null,
      requests,
      submissions,
      openPunchItems,
      retainageBalance,
      // Derived on every read — there is no stored "ready" or "submitted"
      // flag anywhere in this feature.
      readiness: closeoutReadiness(
        {
          requiredItemsTotal: requiredItems(items).length,
          requiredItemsOutstanding: outstandingRequired(items).length,
          openPunchItems,
          openCallbacks: requests.filter(isOpen).length,
          retainageBalance,
          latestSubmission: submissions[0]
            ? {
                status: submissions[0].status,
                submittedOn: submissions[0].submittedOn,
                respondedOn: submissions[0].respondedOn,
              }
            : null,
        },
        todayIso,
      ),
    };
  });
}
