import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { MaterialOrderForm } from "@/components/MaterialOrderForm";
import { MaterialOrderRow } from "@/components/MaterialOrderRow";
import { isLate, orderState } from "@/components/materialOrderLabels";

/** Stored at UTC midnight, rendered in UTC — same rule as RFIs,
 * submittals, the safety log and daily field reports. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function MaterialOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { job: jobFilter, show } = await searchParams;
  const showDelivered = show === "all";

  const today = new Date().toISOString().slice(0, 10);

  const [jobs, vendors, lineItems] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.vendor.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Attribution only — see the note on MaterialOrder.lineItem. Deleted
    // scope is excluded because attributing an order to a line that was
    // removed by change order would be misleading rather than useful.
    prisma.jobLineItem.findMany({
      where: { job: { companyId: company.id }, isDeleted: false },
      orderBy: { description: "asc" },
      select: { id: true, jobId: true, description: true },
    }),
  ]);
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const orders = await prisma.materialOrder.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: {
      job: { select: { name: true } },
      vendor: { select: { name: true } },
      orderedBy: { select: { name: true } },
      lineItem: { select: { description: true } },
      deliveries: { orderBy: { deliveredOn: "asc" } },
    },
  });

  const allRows = orders.map((order) => ({
    id: order.id,
    number: order.number,
    jobId: order.jobId,
    jobName: order.job.name,
    lineItemId: order.lineItemId,
    lineItemDescription: order.lineItem?.description ?? null,
    vendorId: order.vendorId,
    vendorName: order.vendor.name,
    description: order.description,
    vendorReference: order.vendorReference,
    notes: order.notes,
    orderedOn: isoDate(order.orderedOn) as string,
    promisedFor: isoDate(order.promisedFor),
    orderedByName: order.orderedBy?.name ?? null,
    deliveries: order.deliveries.map((delivery) => ({
      id: delivery.id,
      deliveredOn: isoDate(delivery.deliveredOn) as string,
      completesOrder: delivery.completesOrder,
      notes: delivery.notes,
    })),
  }));

  // A delivered order is the normal end state, so it leaves the default
  // view — but stays one click away, because "when did that actually show
  // up" is exactly what someone checks when a schedule is questioned.
  const rows = showDelivered
    ? allRows
    : allRows.filter((row) => orderState(row.deliveries) !== "COMPLETE");

  // Counted from all rows for this filter, not the visible ones — the
  // default view hides exactly the delivered set, and a tile that falls to
  // zero because the things it counts are hidden is the bug the RFI impact
  // tile had.
  const lateCount = allRows.filter((r) => isLate(r.deliveries, r.promisedFor, today)).length;
  const outstandingCount = allRows.filter((r) => orderState(r.deliveries) !== "COMPLETE").length;
  const deliveredCount = allRows.filter((r) => orderState(r.deliveries) === "COMPLETE").length;

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showDelivered ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/material-orders?${qs}` : "/material-orders";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Material orders</h1>
      <p className="mb-6 text-sm text-ink-body">
        What&apos;s on order, who owes it, and whether it actually showed up. Material that
        doesn&apos;t arrive is a crew standing around, and &ldquo;the studs were three weeks
        late&rdquo; is worth nothing in a delay conversation without the date you ordered them and
        the date they promised.
      </p>

      <section className="mb-8">
        <MaterialOrderForm
          jobs={jobs}
          vendors={vendors}
          lineItems={lineItems}
          defaultJobId={activeJob ?? undefined}
        />
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${lateCount > 0 ? "text-red-300" : "text-slate-100"}`}>
            {lateCount}
          </p>
          <p className="text-xs text-slate-500">Past the promised date</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-slate-100">{outstandingCount}</p>
          <p className="text-xs text-slate-500">Still outstanding</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-green-300">{deliveredCount}</p>
          <p className="text-xs text-slate-500">Delivered</p>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={filterHref({ job: null })} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref({ job: j.id })} className={chip(activeJob === j.id)}>
              {j.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">
          {rows.length} {showDelivered ? "total" : "outstanding"}
        </h2>
        <Link href={filterHref({ show: showDelivered ? null : "all" })} className="text-sm text-blue-400">
          {showDelivered ? "Hide delivered" : "Show delivered"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          {allRows.length === 0
            ? "Nothing on order. Log a package the day you place it — the gap between the date you ordered it and the date it turned up is the whole value of the record."
            : `Nothing outstanding — every order on this job has been delivered. ${deliveredCount} delivered order${deliveredCount === 1 ? "" : "s"} hidden.`}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((order) => (
            <MaterialOrderRow
              key={order.id}
              order={order}
              today={today}
              vendors={vendors}
              lineItems={lineItems}
              showJob={!activeJob}
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
