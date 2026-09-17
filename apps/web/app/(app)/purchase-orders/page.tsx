import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { PurchaseOrderRow } from "@/components/PurchaseOrderRow";
import { orderTotal } from "@/components/purchaseOrderTotals";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import { money } from "@/lib/money";

/** Stored at UTC midnight, rendered in UTC — the same rule as material
 * orders, RFIs, submittals and the safety log. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** The company's own address, assembled from the profile fields, for the
 * "bill to" block on the order. Derived at read time from the one place it
 * is kept rather than copied onto every purchase order. */
function hqAddress(company: {
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
}): string | null {
  const cityLine = [company.hqCity, company.hqState].filter(Boolean).join(", ");
  const lines = [
    company.hqAddressLine1,
    company.hqAddressLine2,
    [cityLine, company.hqZip].filter(Boolean).join(" ").trim(),
  ].filter((line): line is string => Boolean(line && line.trim()));
  return lines.length > 0 ? lines.join("\n") : null;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; q?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_BILLING");
  if (!allowed) return <NoAccess capability="MANAGE_BILLING" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter, q } = await searchParams;
  const search = (q ?? "").trim();

  const [companyProfile, jobRows, vendors] = await Promise.all([
    prisma.company.findUnique({
      where: { id: company.id },
      select: {
        name: true,
        dbaName: true,
        hqAddressLine1: true,
        hqAddressLine2: true,
        hqCity: true,
        hqState: true,
        hqZip: true,
      },
    }),
    prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
    }),
    prisma.vendor.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, vendorNumber: true, address: true },
    }),
  ]);

  // status + contact, not the bare name: issue #65 — jobs sharing a
  // placeholder name made every picker a list of identical rows.
  const jobs = jobRows.map(toJobOption);
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  // THE SEARCH IS THE "project number is a searchable field at the top"
  // half of the request, adapted honestly: a Job in this app has a NAME and
  // no number column, so what a contractor types as a project number lives
  // in the job name. It matches the job name, the vendor name, the order's
  // own title and — when the box is a plain number — the PO number itself,
  // which is the other thing somebody arrives holding.
  const numeric = /^\d+$/.test(search) ? Number(search) : null;
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      ...(search
        ? {
            OR: [
              { job: { name: { contains: search, mode: "insensitive" as const } } },
              { vendor: { name: { contains: search, mode: "insensitive" as const } } },
              { title: { contains: search, mode: "insensitive" as const } },
              ...(numeric === null ? [] : [{ number: numeric }]),
            ],
          }
        : {}),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: {
      job: { select: { name: true } },
      vendor: { select: { name: true, vendorNumber: true, address: true } },
      issuedBy: { select: { name: true } },
      lines: {
        orderBy: { sortOrder: "asc" },
        include: { lineItem: { select: { description: true } } },
      },
    },
  });

  const rows = orders.map((order) => ({
    id: order.id,
    number: order.number,
    jobId: order.jobId,
    jobName: order.job.name,
    vendorId: order.vendorId,
    vendorName: order.vendor.name,
    vendorNumber: order.vendor.vendorNumber,
    vendorAddress: order.vendor.address,
    title: order.title,
    shipToAddress: order.shipToAddress,
    paymentTerms: order.paymentTerms,
    awardedOn: isoDate(order.awardedOn) as string,
    expectedOn: isoDate(order.expectedOn),
    notes: order.notes,
    issuedByName: order.issuedBy?.name ?? null,
    lines: order.lines.map((line) => ({
      id: line.id,
      lineItemId: line.lineItemId,
      costCode: line.lineItem?.description ?? null,
      description: line.description,
      quantity: Number(line.quantity),
      unit: line.unit,
      unitCost: Number(line.unitCost),
    })),
  }));

  // The cost codes on offer are the SOV lines of the jobs in view. Deleted
  // scope is excluded: coding a commitment to a line removed by change
  // order would be misleading rather than useful.
  const costCodeRows = await prisma.jobLineItem.findMany({
    where: {
      job: { companyId: company.id },
      isDeleted: false,
      ...(rows.length > 0 ? { jobId: { in: [...new Set(rows.map((r) => r.jobId))] } } : {}),
    },
    orderBy: { description: "asc" },
    select: { id: true, jobId: true, description: true },
  });

  // Committed, not spent — and the tile says so, because the two are
  // different facts and a number that blurs them is worse than no number.
  const committed = rows.reduce((sum, row) => sum + orderTotal(row.lines), 0);

  const billToName = companyProfile?.dbaName || companyProfile?.name || company.name;
  const billToAddress = companyProfile ? hqAddress(companyProfile) : null;

  const filterHref = (jobId: string | null) => {
    const next = new URLSearchParams();
    if (jobId) next.set("job", jobId);
    if (search) next.set("q", search);
    const qs = next.toString();
    return qs ? `/purchase-orders?${qs}` : "/purchase-orders";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Purchase orders</h1>
      <p className="mb-6 text-sm text-ink-body">
        What you have committed to buy, from whom, at what price, against which job. A purchase
        order is the priced commitment; the material order next door is the delivery — whether it
        actually turned up.
      </p>

      {/* A plain GET form, so the search survives a reload, can be
          bookmarked, and works before any JavaScript has run. */}
      <form method="get" action="/purchase-orders" className="mb-6 flex flex-wrap gap-2">
        {activeJob && <input type="hidden" name="job" value={activeJob} />}
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search by project, vendor, what it is for, or PO number"
          className="min-w-0 flex-1 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Search
        </button>
        {search && (
          <Link href={activeJob ? `/purchase-orders?job=${activeJob}` : "/purchase-orders"} className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800">
            Clear
          </Link>
        )}
      </form>

      <section className="mb-8">
        <PurchaseOrderForm jobs={jobs} vendors={vendors} defaultJobId={activeJob ?? undefined} />
      </section>

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={filterHref(null)} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref(j.id)} className={chip(activeJob === j.id)}>
              {jobPickerLabel(j)}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">
          {rows.length} purchase order{rows.length === 1 ? "" : "s"}
        </h2>
        {rows.length > 0 && (
          <p className="text-sm text-ink-body">
            {money(committed)} committed <span className="text-ink-muted">— not what has been spent</span>
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-body">
          {search || activeJob
            ? "No purchase orders match that. Clear the search, or pick All jobs, to see the rest."
            : "No purchase orders yet. Raise one the day you award it — the number, the price you agreed and the terms are what a vendor's invoice gets checked against months later."}
        </p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {rows.map((order) => (
            <PurchaseOrderRow
              key={order.id}
              order={order}
              vendors={vendors}
              costCodes={costCodeRows
                .filter((code) => code.jobId === order.jobId)
                .map((code) => ({ id: code.id, description: code.description }))}
              billToName={billToName}
              billToAddress={billToAddress}
              canDelete={currentUser.role === "OWNER"}
              showJob={!activeJob}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
