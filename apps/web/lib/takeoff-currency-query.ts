import { prisma } from "@prova/db";

import {
  takeoffCurrency,
  undatedAddenda,
  type IssuedRevision,
  type MeasuredPlan,
  type PricedScopeAddendum,
  type TakeoffCurrency,
} from "./takeoff-currency";

const day = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));

export type JobTakeoffCurrency = TakeoffCurrency & {
  /** Addenda that claim to have changed priced work but carry no issue date,
   * so nothing can place them in time. Reported, never dropped. */
  undated: string[];
};

/**
 * Whether this job's measured plans came off current drawings.
 *
 * THREE SOURCES, AND NOTHING JOINS THEM — which is the design rather than a
 * limitation. `TakeoffPlan` carries the label and date it was measured
 * against as TEXT; `DrawingRevision` is the job's own paper trail;
 * `BidAddendum` belongs to a bid invitation and has no `jobId` at all. They
 * are compared by date in the pure module.
 *
 * THE BID SIDE IS REACHED THROUGH `BidInvitation.wonJobId`, the link #491
 * added, and only that way. A bid is connected to a job when somebody said so
 * — names rarely match and one GC sends three invitations per building, so
 * anything fuzzier would attach another project's addenda to this job's
 * measurements and warn about the wrong thing.
 */
export async function loadTakeoffCurrency(
  companyId: string,
  jobId: string,
): Promise<JobTakeoffCurrency> {
  const [plans, sets, bids] = await Promise.all([
    prisma.takeoffPlan.findMany({
      where: { jobId, companyId },
      select: {
        id: true,
        fileName: true,
        revisionLabel: true,
        sheetIssuedOn: true,
        pages: { select: { _count: { select: { measurements: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.drawingSet.findMany({
      where: { jobId, companyId },
      select: {
        name: true,
        revisions: { select: { id: true, label: true, issuedOn: true, description: true } },
      },
    }),
    // Only a bid somebody LINKED to this job, and only addenda flagged as
    // changing work that was already priced. An addendum that changed nothing
    // we priced is not a reason to re-check a measurement.
    prisma.bidInvitation.findMany({
      where: { companyId, wonJobId: jobId },
      select: {
        addenda: {
          where: { affectsPricedScope: true },
          select: { id: true, reference: true, issuedOn: true, impactNote: true },
        },
      },
    }),
  ]);

  const measured: MeasuredPlan[] = plans.map((plan) => ({
    id: plan.id,
    fileName: plan.fileName,
    revisionLabel: plan.revisionLabel,
    sheetIssuedOn: day(plan.sheetIssuedOn),
    measurementCount: plan.pages.reduce((sum, page) => sum + page._count.measurements, 0),
  }));

  const revisions: IssuedRevision[] = sets.flatMap((set) =>
    set.revisions.map((revision) => ({
      id: revision.id,
      label: revision.label,
      setName: set.name,
      // `issuedOn` is required on DrawingRevision, so this is never null.
      issuedOn: day(revision.issuedOn) as string,
      description: revision.description,
    })),
  );

  const addenda: PricedScopeAddendum[] = bids.flatMap((bid) =>
    bid.addenda.map((addendum) => ({
      id: addendum.id,
      reference: addendum.reference,
      issuedOn: day(addendum.issuedOn),
      impactNote: addendum.impactNote,
    })),
  );

  return {
    ...takeoffCurrency(measured, revisions, addenda),
    undated: undatedAddenda(addenda),
  };
}
