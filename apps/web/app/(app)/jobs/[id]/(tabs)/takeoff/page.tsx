import Link from "next/link";
import { prisma } from "@prova/db";

import { NoAccess } from "@/components/NoAccess";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { TakeoffMeasurementList } from "@/components/TakeoffMeasurementList";
import { TakeoffPlanUploader } from "@/components/TakeoffPlanUploader";
import { TakeoffPlanViewer } from "@/components/TakeoffPlanViewer";
import { deleteTakeoffPlan } from "@/lib/actions";
import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import type { PlanMeasurementRow, PlanSheet } from "@/lib/takeoff-plan-view";

/**
 * TAKEOFF — measure a drawing on screen and turn what you traced into
 * estimate quantities.
 *
 * Hard-gated on VIEW_JOB_COSTS, the same capability the Estimate tab withholds
 * its content behind and the same one every write here asserts (issue #383).
 * One gate, one door: a second capability on this page would make it ambiguous
 * to `action-capability-guards.test.ts` and force every action behind it onto
 * a known-open list.
 *
 * WHAT THIS PAGE IS NOT. It is not a drawing register and must not become one.
 * `NAV-IA-AUDIT.md` records the decision to stay out of the
 * drawings/markup/sheet-management category that Procore, Fieldwire and
 * Bluebeam own deeply. The issued set, with the architect's own revision
 * labels, lives on `/drawings`. This is a measuring tool that happens to need
 * a drawing in front of it.
 *
 * NOTHING ON THIS PAGE IS A STORED QUANTITY. Every length, area and count is
 * derived on each render from the traced geometry and the sheet's calibration,
 * by the same pure module the Server Action re-runs before it writes anything.
 */
export default async function JobTakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { company, job } = await requireJobGivenContext(id, context);

  const plan = await prisma.takeoffPlan.findFirst({
    where: { jobId: job.id, companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: {
      pages: {
        orderBy: { pageNumber: "asc" },
        include: {
          calibrations: { orderBy: { createdAt: "desc" } },
          measurements: {
            orderBy: { createdAt: "asc" },
            include: { calibration: true },
          },
        },
      },
    },
  });

  const isEstimateStage = job.status === "ESTIMATE";

  if (!plan) {
    return (
      <section className="flex flex-col gap-4">
        <Header jobId={job.id} />
        <div className="rounded-lg border border-line-card bg-surface-card p-4">
          <h3 className="text-sm font-semibold text-ink-label">No drawing on this job yet</h3>
          <p className="mt-1 max-w-prose text-sm text-ink-body">
            Upload a sheet, set its scale against a dimension printed on it, then click along what you&rsquo;re taking
            off. Lengths, areas and counts become estimate line items — unpriced, the way the typed takeoff form
            already works.
          </p>
          <div className="mt-3">{isEstimateStage ? <TakeoffPlanUploader jobId={job.id} /> : <NotEstimating />}</div>
        </div>
      </section>
    );
  }

  // DERIVED HERE, NOT STORED: which calibration is current, and therefore
  // which measurements read at an older scale. Nothing on the row says so.
  const sheets: PlanSheet[] = plan.pages.map((page) => {
    const current = page.calibrations[0] ?? null;
    const measurements: PlanMeasurementRow[] = page.measurements.map((m) => ({
      id: m.id,
      kind: m.kind,
      xs: m.xs,
      ys: m.ys,
      label: m.label,
      postedAt: m.postedAt ? m.postedAt.toISOString() : null,
      calibration: {
        x1: m.calibration.x1,
        y1: m.calibration.y1,
        x2: m.calibration.x2,
        y2: m.calibration.y2,
        declaredDistanceFeet: m.calibration.declaredDistanceFeet.toNumber(),
      },
      outOfDate: current !== null && m.calibrationId !== current.id,
    }));
    return {
      id: page.id,
      pageNumber: page.pageNumber,
      label: page.label,
      pageWidthPt: page.pageWidthPt,
      calibration: current
        ? {
            id: current.id,
            x1: current.x1,
            y1: current.y1,
            x2: current.x2,
            y2: current.y2,
            declaredDistanceFeet: current.declaredDistanceFeet.toNumber(),
          }
        : null,
      measurements,
    };
  });

  return (
    <section className="flex flex-col gap-4">
      <Header jobId={job.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-body">
          {plan.fileName ?? "Drawing"}
          {plan.pages.length > 0 && (
            <span className="text-ink-muted">
              {" "}
              · {plan.pages.length} sheet{plan.pages.length === 1 ? "" : "s"} worked on
            </span>
          )}
        </p>
        {isEstimateStage && (
          <ConfirmDeleteButton
            label="Delete plan"
            describe="Removes the drawing and everything traced on it. Line items already added to the estimate are not changed."
            action={async () => {
              "use server";
              await deleteTakeoffPlan(job.id, plan.id);
            }}
          />
        )}
      </div>

      {!isEstimateStage && <NotEstimating />}

      <TakeoffPlanViewer jobId={job.id} planId={plan.id} sheets={sheets} />

      {sheets.map((sheet) => (
        <div key={sheet.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-label">
            Measured on sheet {sheet.pageNumber}
            {sheet.label ? ` — ${sheet.label}` : ""}
          </h3>
          <TakeoffMeasurementList jobId={job.id} sheet={sheet} />
        </div>
      ))}
    </section>
  );
}

function Header({ jobId }: { jobId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-ink-strong">Takeoff</h2>
      <p className="max-w-prose text-sm text-ink-body">
        Measure a drawing on screen. Set the scale on each sheet against a dimension printed on it, trace what
        you&rsquo;re taking off, and add it to the estimate.{" "}
        <Link href={`/jobs/${jobId}/estimate`} className="text-link hover:text-link-hover">
          Ceilings and anything you already have dimensions for
        </Link>{" "}
        are typed on the Estimate tab instead — a traced outline has an area, not a length and a width.
      </p>
    </div>
  );
}

function NotEstimating() {
  return (
    <p className="rounded-lg border border-line-row bg-amber-500/5 p-3 text-sm text-tag-amber-ink">
      This job is past the estimate stage, so line items are changed through a change order rather than added
      directly. You can still read what was measured.
    </p>
  );
}
