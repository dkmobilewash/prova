import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import {
  createBidInvitation,
  deleteBidInvitation,
  enablePortalAccess,
  updateBidInvitationStatus,
  updateContact,
} from "@/lib/actions";
import { money } from "@/lib/money";
import { calculatePaymentReliability } from "@/lib/gc-reliability";

const BID_STATUS_OPTIONS = [
  { value: "INVITED", label: "Invited" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "DECLINED", label: "Declined" },
] as const;

const BID_STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-slate-800 text-slate-300",
  SUBMITTED: "bg-blue-500/15 text-blue-300",
  WON: "bg-green-500/15 text-green-300",
  LOST: "bg-red-950 text-red-400",
  DECLINED: "bg-slate-800 text-slate-500",
};

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString() : "—";
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        include: {
          lineItems: { where: { isDeleted: false } },
          invoices: { include: { payments: true } },
        },
      },
      bidInvitations: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!contact || contact.companyId !== company.id) {
    notFound();
  }

  const reliability = calculatePaymentReliability(
    contact.jobs.flatMap((job) =>
      job.invoices.map((invoice) => {
        const paidAmount = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const lastPaymentAt = invoice.payments.reduce<Date | null>(
          (latest, p) => (!latest || p.receivedAt > latest ? p.receivedAt : latest),
          null,
        );
        return {
          amount: Number(invoice.amount),
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          paidAmount,
          lastPaymentAt,
        };
      }),
    ),
  );

  const updateContactWithId = updateContact.bind(null, contact.id);
  const enablePortalWithId = enablePortalAccess.bind(null, contact.id);
  const createBidInvitationWithId = createBidInvitation.bind(null, contact.id);

  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-100">Edit contact</h1>
        <form action={updateContactWithId} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Name
            <input
              name="name"
              defaultValue={contact.name}
              required
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Email
            <input
              name="email"
              type="email"
              defaultValue={contact.email ?? ""}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Phone
            <input
              name="phone"
              defaultValue={contact.phone ?? ""}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Address
            <input
              name="address"
              defaultValue={contact.address ?? ""}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Standing terms with this GC
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Default retainage %
              <input
                name="defaultRetainagePercent"
                defaultValue={contact.defaultRetainagePercent?.toString() ?? ""}
                placeholder="e.g. 10"
                className="w-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Payment terms (days)
              <input
                name="paymentTermsDays"
                defaultValue={contact.paymentTermsDays?.toString() ?? ""}
                placeholder="e.g. 30"
                className="w-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-slate-300">
              Standard forms used
              <input
                name="standardFormsUsed"
                defaultValue={contact.standardFormsUsed ?? ""}
                placeholder="e.g. AIA A401"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          <button
            type="submit"
            className="mt-2 inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Save
          </button>
        </form>
      </section>

      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-1 text-lg font-semibold text-slate-100">Payment reliability</h2>
        <p className="mb-4 text-sm text-slate-400">
          Computed from every invoice/payment on {contact.name}&apos;s jobs — nothing here is a stored
          score, just today&apos;s numbers.
        </p>
        {reliability.invoiceCount === 0 ? (
          <p className="text-sm text-slate-400">No invoices yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Invoiced</p>
              <p className="text-lg font-semibold text-slate-100">{money(reliability.invoicedTotal)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding</p>
              <p className="text-lg font-semibold text-slate-100">{money(reliability.outstandingTotal)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Paid on time</p>
              <p className="text-lg font-semibold text-slate-100">
                {reliability.onTimeRate == null ? "—" : percent(reliability.onTimeRate)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Avg. days to pay</p>
              <p className="text-lg font-semibold text-slate-100">
                {reliability.averageDaysToPay == null ? "—" : Math.round(reliability.averageDaysToPay)}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Bid invitations</h2>
        {contact.bidInvitations.length === 0 ? (
          <p className="mb-4 text-sm text-slate-400">No bid invitations logged from {contact.name} yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-800 border-y border-slate-800">
            {contact.bidInvitations.map((bid) => (
              <li key={bid.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{bid.projectName}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BID_STATUS_STYLE[bid.status]}`}
                    >
                      {BID_STATUS_OPTIONS.find((o) => o.value === bid.status)?.label ?? bid.status}
                    </span>
                  </div>
                  {bid.dueDate && <p className="text-sm text-slate-400">Due {formatDate(bid.dueDate)}</p>}
                  {bid.notes && <p className="text-sm text-slate-500">{bid.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <form action={updateBidInvitationStatus.bind(null, bid.id)} className="flex items-center gap-2">
                    <select
                      name="status"
                      defaultValue={bid.status}
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      {BID_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Update
                    </button>
                  </form>
                  <form action={deleteBidInvitation.bind(null, bid.id)}>
                    <button type="submit" className="text-xs text-red-400 hover:underline">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={createBidInvitationWithId} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Project name
            <input
              name="projectName"
              required
              placeholder="Downtown office build-out"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Bid due date
            <input
              name="dueDate"
              type="date"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-1 min-w-[180px] flex-col gap-1 text-sm text-slate-300">
            Notes
            <input
              name="notes"
              placeholder="Optional"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Log invitation
          </button>
        </form>
      </section>

      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Client portal</h2>
        {contact.portalToken ? (
          <div className="text-sm">
            <p className="mb-2 text-slate-300">
              Share this link so {contact.name} can view their jobs, contracts, and invoices:
            </p>
            <p className="break-all rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-blue-400">
              {origin}/portal/{contact.portalToken}
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-slate-400">
              No portal access yet. This gives {contact.name} a read-only link to view their jobs
              — no login required.
            </p>
            <form action={enablePortalWithId}>
              <button
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Enable client portal
              </button>
            </form>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Jobs</h2>
        {contact.jobs.length === 0 ? (
          <p className="text-slate-400">No jobs for this contact yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {contact.jobs.map((job) => {
              const total = job.lineItems.reduce(
                (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
                0,
              );
              return (
                <li key={job.id} className="p-4">
                  <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-100">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm font-medium text-slate-100">{money(total)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
