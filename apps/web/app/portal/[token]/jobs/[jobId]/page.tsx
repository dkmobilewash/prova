import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractSummary } from "@/components/ContractSummary";
import { prisma } from "@prova/db";
import { portalAccessFor, signingLinkState } from "@/lib/link-access";
import { money } from "@/lib/money";

export default async function PortalJobPage({
  params,
}: {
  params: Promise<{ token: string; jobId: string }>;
}) {
  const { token, jobId } = await params;

  const contact = await prisma.contact.findUnique({ where: { portalToken: token } });
  // Same gate, same 404, same reason as /portal/[token] — see there and in
  // lib/link-access.ts. Repeated rather than shared because this page is
  // reachable directly: a GC bookmarks a job, and a check that only ran on
  // the index would be no check at all.
  if (!contact || !portalAccessFor(contact).ok) {
    notFound();
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      company: true,
      contact: true,
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: { originChangeOrder: true },
      },
      // APPROVED ONLY. This list had no status filter, so the GC's own
      // portal showed them our DRAFTS — change orders written but never
      // sent — alongside the ones we VOIDED before ever asking, and the
      // numbering gaps that reveal both. This is the only surface in the
      // app where the client sees the sub's unsent internal state, in a
      // product whose stated rule is that every decision is made for the
      // sub. An approved change order is the only one the GC has any
      // business reading here: it is the one they already agreed to, and
      // the only one whose line items are already in the summary above.
      changeOrders: {
        where: { status: "APPROVED" },
        orderBy: { number: "asc" },
        include: { edits: true },
      },
      signatureRequests: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      invoices: {
        orderBy: { number: "asc" },
        include: { payments: { orderBy: { receivedAt: "desc" } } },
      },
    },
  });

  if (!job || job.contactId !== contact.id) {
    notFound();
  }

  // Only offer the signing button while the link behind it would actually
  // open. A "Review and sign contract" button that lands on "this link is no
  // longer live" is the sub looking broken in front of their client, on the
  // one screen where that costs them something.
  const pendingSignature = job.signatureRequests.find(
    (request) => signingLinkState(request, job, new Date()).state === "SIGNABLE",
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/portal/${token}`} className="mb-6 inline-block text-sm text-blue-400 hover:underline">
        ← Back to your jobs
      </Link>

      <div className="mb-10">
        <ContractSummary
          companyName={job.company.name}
          jobName={job.name}
          status={job.status}
          clientName={job.contact.name}
          scope={job.scope}
          lineItems={job.lineItems.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity.toString(),
            unit: item.unit,
            unitPrice: item.unitPrice?.toString() ?? null,
            changeOrderNumber: item.originChangeOrder?.number ?? null,
          }))}
          footer={
            pendingSignature ? (
              <Link
                href={`/esign/${pendingSignature.token}`}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Review and sign contract
              </Link>
            ) : undefined
          }
        />
      </div>

      {job.changeOrders.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Change orders</h2>
          <ul className="flex flex-col gap-2">
            {job.changeOrders.map((co) => (
              <li key={co.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
                <p className="font-medium text-slate-100">
                  CO #{co.number}: {co.title}
                </p>
                {co.description && <p className="text-slate-400">{co.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.invoices.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Invoices</h2>
          <ul className="flex flex-col gap-2">
            {job.invoices.map((invoice) => {
              const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
              const balance = Number(invoice.amount) - paid;
              return (
                <li key={invoice.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-slate-100">
                      Invoice #{invoice.number}
                      {invoice.description ? ` — ${invoice.description}` : ""}
                    </p>
                    <span className={balance <= 0 ? "text-green-400" : "text-amber-400"}>
                      {balance <= 0 ? "Paid in full" : `Balance ${money(balance)}`}
                    </span>
                  </div>
                  <p className="text-slate-400">Amount {money(Number(invoice.amount))}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
