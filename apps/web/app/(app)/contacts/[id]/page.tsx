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
  revokeClientPortalAccess,
  updateBidInvitationStatus,
} from "@/lib/actions";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";
import { can } from "@/lib/permissions";
import { calculatePaymentReliability } from "@/lib/gc-reliability";
import { SubmitButton } from "@/components/SubmitButton";
import { LinkContactToQuickBooks } from "@/components/LinkContactToQuickBooks";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { ContactEditForm } from "@/components/ContactEditForm";
import { ContactInteractionForm } from "@/components/ContactInteractionForm";
import { ContactInteractionRow } from "@/components/ContactInteractionRow";
import { ContactPersonForm } from "@/components/ContactPersonForm";
import { ContactPersonRow } from "@/components/ContactPersonRow";
import { toIsoDate } from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";

const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

const BID_STATUS_OPTIONS = [
  { value: "INVITED", label: "Invited" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "DECLINED", label: "Declined" },
] as const;

const BID_STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-neutral-100 text-ink-label",
  SUBMITTED: "bg-tag-blue text-tag-blue-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-red-600",
  DECLINED: "bg-neutral-100 text-ink-muted",
};

function formatDate(date: Date | null) {
  return date ? formatCalendarDate(date, "numeric") : "—";
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company, ...currentUser } = await requireCompanyContext();

  // Both TRUE for an owner and for a member with no job function set. A
  // foreman keeps the GC's phone number and loses their payment history.
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };
  const showsBilling = can(principal, "MANAGE_BILLING");
  const showsJobMoney = can(principal, "VIEW_JOB_COSTS");
  const showsEstimating = can(principal, "MANAGE_ESTIMATING");

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
      interactions: {
        orderBy: { occurredOn: "desc" },
        include: { loggedByUser: true, followUpAssignedToUser: true },
      },
      people: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!contact || contact.companyId !== company.id) {
    notFound();
  }

  const companyMembers = await prisma.user.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "asc" },
  });
  const memberOptions = companyMembers.map((m) => ({ id: m.id, name: m.name ?? m.email }));
  const personOptions = contact.people.map((p) => ({ id: p.id, name: p.name }));
  const personNameById = new Map(personOptions.map((p) => [p.id, p.name]));

  // "Last contact" per person is derived from the interaction log at read
  // time, never stored -- contact.interactions is already ordered newest
  // first, so the first hit per person is the max.
  const lastContactByPersonId = new Map<string, string>();
  for (const interaction of contact.interactions) {
    if (!interaction.contactPersonId) continue;
    if (!lastContactByPersonId.has(interaction.contactPersonId)) {
      lastContactByPersonId.set(interaction.contactPersonId, toIsoDate(interaction.occurredOn) ?? "");
    }
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
          // What a payment platform took in transit. A fee is not a
          // shortfall — see lib/gc-reliability.ts and issue #189.
          feesDeducted: invoice.payments.reduce((sum, p) => sum + Number(p.feeAmount ?? 0), 0),
          lastPaymentAt,
        };
      }),
    ),
  );

  // Only asked for when QuickBooks is connected — otherwise the control
  // below would offer something that cannot work.
  const quickBooksConnected =
    (await prisma.quickBooksConnection.count({ where: { companyId: company.id } })) > 0;
  const quickBooksCustomerLink = quickBooksConnected
    ? await prisma.quickBooksEntityLink.findUnique({
        where: {
          companyId_entityType_entityId: {
            companyId: company.id,
            entityType: "Contact",
            entityId: contact.id,
          },
        },
        select: { qboId: true },
      })
    : null;

  const enablePortalWithId = enablePortalAccess.bind(null, contact.id);
  const revokePortalWithId = revokeClientPortalAccess.bind(null, contact.id);
  const createBidInvitationWithId = createBidInvitation.bind(null, contact.id);

  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
        <h1 className="mb-4 text-lg font-semibold text-ink">Edit contact</h1>
        <ContactEditForm
          contactId={contact.id}
          today={serverToday()}
          defaults={{
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            address: contact.address,
            status: contact.status,
            accountType: contact.accountType,
            defaultRetainagePercent: contact.defaultRetainagePercent?.toString() ?? null,
            paymentTermsDays: contact.paymentTermsDays?.toString() ?? null,
            standardFormsUsed: contact.standardFormsUsed,
            msaExpirationDate: toIsoDate(contact.msaExpirationDate),
            prequalificationExpiresAt: toIsoDate(contact.prequalificationExpiresAt),
          }}
        />
      </section>

      {showsBilling && (
      <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold text-ink">Payment reliability</h2>
        <p className="mb-4 text-sm text-ink-body">
          Computed from every invoice/payment on {contact.name}&apos;s jobs — nothing here is a stored
          score, just today&apos;s numbers.
        </p>
        {reliability.invoiceCount === 0 ? (
          <p className="text-sm text-ink-body">No invoices yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">Invoiced</p>
              <p className="text-lg font-semibold text-ink">{money(reliability.invoicedTotal)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">Outstanding</p>
              <p className="text-lg font-semibold text-ink">{money(reliability.outstandingTotal)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">Paid on time</p>
              <p className="text-lg font-semibold text-ink">
                {reliability.onTimeRate == null ? "—" : percent(reliability.onTimeRate)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">Avg. days to pay</p>
              <p className="text-lg font-semibold text-ink">
                {reliability.averageDaysToPay == null ? "—" : Math.round(reliability.averageDaysToPay)}
              </p>
            </div>
          </div>
        )}
      </section>
      )}

      {showsEstimating && (
      <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">Bid invitations</h2>
        {contact.bidInvitations.length === 0 ? (
          <p className="mb-4 text-sm text-ink-body">No bid invitations logged from {contact.name} yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-line-row border-y border-line-row">
            {contact.bidInvitations.map((bid) => (
              <li key={bid.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink">{bid.projectName}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BID_STATUS_STYLE[bid.status]}`}
                    >
                      {BID_STATUS_OPTIONS.find((o) => o.value === bid.status)?.label ?? bid.status}
                    </span>
                  </div>
                  <p className="text-sm text-ink-body">
                    {bid.tradeScope && (
                      <>{TRADE_SCOPE_OPTIONS.find((t) => t.value === bid.tradeScope)?.label} · </>
                    )}
                    {bid.dueDate && <>Due {formatDate(bid.dueDate)}</>}
                  </p>
                  {bid.bidAmount != null && (
                    <p className="text-sm text-ink-label">{money(Number(bid.bidAmount))}</p>
                  )}
                  {bid.notes && <p className="text-sm text-ink-muted">{bid.notes}</p>}
                </div>
                {/* Two-step delete (#105 finding 6). It used to be one click,
                    straight to the server, sitting beside "Update" with no
                    confirm and nothing recoverable — the catalog entry row
                    already has the two-step pattern this borrows. A won bid
                    is what /pipeline reads a win rate from and what the AI
                    drafts are grounded in, so the confirm step says so before
                    the click goes through. RowActions (not a bare
                    ConfirmDeleteButton) because "Update" is a live ordinary
                    action right next to it — arming the delete has to hide
                    it too, or a hurried second click can land on Update
                    instead. */}
                <RowActions
                  className="flex items-center gap-2"
                  destructive={
                    <ConfirmDelete
                      pinned="end"
                      action={deleteBidInvitation.bind(null, bid.id)}
                      deleteClassName="text-xs text-ink-body hover:text-red-600 hover:underline"
                      cancelClassName="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-100"
                      confirmClassName="rounded-md border border-red-500 px-2 py-1 text-xs text-red-600 hover:bg-tag-rose"
                      hint={
                        bid.status === "WON" ? (
                          <span className="max-w-[14rem] text-right text-tag-amber-ink">
                            This is a won bid. Deleting it removes it from your win rate with this GC,
                            permanently.
                          </span>
                        ) : (
                          <span className="max-w-[14rem] text-right text-ink-muted">
                            Deleted for good — bid history is what win rates and past pricing are read
                            from.
                          </span>
                        )
                      }
                    />
                  }
                >
                  <form action={updateBidInvitationStatus.bind(null, bid.id)} className="flex items-center gap-2">
                    <select
                      key={bid.status}
                      name="status"
                      defaultValue={bid.status}
                      className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                    >
                      {BID_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      name="bidAmount"
                      defaultValue={bid.bidAmount?.toString() ?? ""}
                      placeholder="Bid $"
                      title="Amount bid, once known"
                      className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                    />
                    <SubmitButton
                      type="submit"
                      className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-ink hover:bg-neutral-200"
                    >
                      Update
                    </SubmitButton>
                  </form>
                </RowActions>
              </li>
            ))}
          </ul>
        )}
        <form action={createBidInvitationWithId} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Project name
            <input
              name="projectName"
              required
              placeholder="Downtown office build-out"
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Trade
            <select
              name="tradeScope"
              defaultValue=""
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
            >
              <option value="">No trade tag</option>
              {TRADE_SCOPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Bid due date
            <input
              name="dueDate"
              type="date"
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-1 min-w-[180px] flex-col gap-1 text-sm text-ink-label">
            Notes
            <input
              name="notes"
              placeholder="Optional"
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <SubmitButton
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-200"
          >
            Log invitation
          </SubmitButton>
        </form>
      </section>
      )}

      {showsEstimating && (
        <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
          <h2 className="mb-1 text-lg font-semibold text-ink">People</h2>
          <p className="mb-4 text-sm text-ink-body">
            The individuals at {contact.name} -- not a separate account of their own, just who to
            actually call.
          </p>
          {contact.people.length === 0 ? (
            <p className="mb-4 text-sm text-ink-body">No one added at {contact.name} yet.</p>
          ) : (
            <ul className="mb-4 divide-y divide-line-row border-y border-line-row">
              {contact.people.map((person) => (
                <ContactPersonRow
                  key={person.id}
                  person={{
                    id: person.id,
                    name: person.name,
                    title: person.title,
                    email: person.email,
                    phone: person.phone,
                    lastContactOn: lastContactByPersonId.get(person.id) ?? null,
                  }}
                />
              ))}
            </ul>
          )}
          <ContactPersonForm contactId={contact.id} />
        </section>
      )}

      {showsEstimating && (
        <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
          <h2 className="mb-3 text-lg font-semibold text-ink">Interactions</h2>
          <p className="mb-4 text-sm text-ink-body">
            Calls, emails, site visits, and notes with {contact.name} -- a log of the relationship,
            not just the paperwork.
          </p>
          {contact.interactions.length === 0 ? (
            <p className="mb-4 text-sm text-ink-body">No interactions logged with {contact.name} yet.</p>
          ) : (
            <ul className="mb-4 divide-y divide-line-row border-y border-line-row">
              {contact.interactions.map((interaction) => (
                <ContactInteractionRow
                  key={interaction.id}
                  members={memberOptions}
                  people={personOptions}
                  interaction={{
                    id: interaction.id,
                    type: interaction.type,
                    occurredOn: toIsoDate(interaction.occurredOn) ?? "",
                    summary: interaction.summary,
                    followUpOn: toIsoDate(interaction.followUpOn),
                    followUpAssignedToUserId: interaction.followUpAssignedToUserId,
                    followUpAssignedToUserName:
                      interaction.followUpAssignedToUser?.name ?? interaction.followUpAssignedToUser?.email ?? null,
                    loggedByUserName: interaction.loggedByUser?.name ?? interaction.loggedByUser?.email ?? null,
                    contactPersonId: interaction.contactPersonId,
                    contactPersonName: interaction.contactPersonId
                      ? (personNameById.get(interaction.contactPersonId) ?? null)
                      : null,
                  }}
                />
              ))}
            </ul>
          )}
          <ContactInteractionForm contactId={contact.id} members={memberOptions} people={personOptions} />
        </section>
      )}

      {quickBooksConnected && (
        <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
          <h2 className="mb-3 text-lg font-semibold text-ink">QuickBooks</h2>
          <p className="mb-3 text-sm text-ink-body">
            Invoices for this GC&apos;s jobs can only be pushed once they&apos;re linked to a
            QuickBooks customer. An existing customer with the same name is reused rather than
            duplicated — a second copy would split the payment history your bookkeeper already
            has.
          </p>
          <LinkContactToQuickBooks
            contactId={contact.id}
            contactName={contact.name}
            linkedQboId={quickBooksCustomerLink?.qboId ?? null}
          />
        </section>
      )}

      <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">Client portal</h2>
        {contact.portalToken && contact.portalRevokedAt ? (
          // Issue #106 finding 2 / #217: revoked, not deleted or rotated —
          // the link below stays visible so re-enabling doesn't require
          // regenerating and re-sending a new one.
          <div className="text-sm">
            <p className="mb-2 text-tag-amber-ink">
              Portal access is revoked. This link no longer works for {contact.name}.
            </p>
            <p className="mb-3 break-all rounded-md bg-canvas px-3 py-2 font-mono text-xs text-ink-muted line-through">
              {origin}/portal/{contact.portalToken}
            </p>
            <form action={enablePortalWithId}>
              <SubmitButton
                type="submit"
                className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-200"
              >
                Re-enable client portal
              </SubmitButton>
            </form>
          </div>
        ) : contact.portalToken ? (
          <div className="text-sm">
            <p className="mb-2 text-ink-label">
              Share this link so {contact.name} can view their jobs, contracts, and invoices:
            </p>
            <p className="mb-3 break-all rounded-md bg-canvas px-3 py-2 font-mono text-xs text-link">
              {origin}/portal/{contact.portalToken}
            </p>
            <form action={revokePortalWithId}>
              <SubmitButton
                type="submit"
                className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-tag-rose-ink hover:bg-tag-rose"
              >
                Revoke portal access
              </SubmitButton>
            </form>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-ink-body">
              No portal access yet. This gives {contact.name} a read-only link to view their jobs
              — no login required.
            </p>
            <form action={enablePortalWithId}>
              <SubmitButton
                type="submit"
                className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-200"
              >
                Enable client portal
              </SubmitButton>
            </form>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Jobs</h2>
        {contact.jobs.length === 0 ? (
          <p className="text-ink-body">No jobs for this contact yet.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {contact.jobs.map((job) => {
              const total = job.lineItems.reduce(
                (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
                0,
              );
              return (
                <li key={job.id} className="p-4">
                  <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ink">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    {showsJobMoney && (
                      <p className="text-sm font-medium text-ink">{money(total)}</p>
                    )}
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
