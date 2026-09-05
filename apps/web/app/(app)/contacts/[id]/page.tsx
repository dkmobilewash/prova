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
} from "@/lib/actions";
import { money } from "@/lib/money";
import { can } from "@/lib/permissions";
import { calculatePaymentReliability } from "@/lib/gc-reliability";
import { SubmitButton } from "@/components/SubmitButton";
import { LinkContactToQuickBooks } from "@/components/LinkContactToQuickBooks";
import { ContactEditForm } from "@/components/ContactEditForm";
import { ContactInteractionForm } from "@/components/ContactInteractionForm";
import { ContactInteractionRow } from "@/components/ContactInteractionRow";
import { ContactPersonForm } from "@/components/ContactPersonForm";
import { ContactPersonRow } from "@/components/ContactPersonRow";
import { MergeContactForm, type MergeCandidate } from "@/components/MergeContactForm";
import { planContactMerge } from "@/lib/contact-merge";
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

  // Merging is owner-only and irreversible, so the screen has to show what
  // would move BEFORE anyone commits — not a count read back afterwards.
  // The fields half is decided by planContactMerge, the same function the
  // action runs, against the same two rows: the preview and the write cannot
  // drift apart.
  const canMerge = currentUser.role === "OWNER";
  let mergeCandidates: MergeCandidate[] = [];
  let winnerHasQuickBooksLink = false;
  if (canMerge) {
    const others = await prisma.contact.findMany({
      where: { companyId: company.id, id: { not: contact.id } },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { jobs: true, bidInvitations: true, interactions: true, people: true } },
      },
    });
    // One query for every contact link in the company rather than one per
    // candidate: there is no foreign key here, so this is a plain string
    // lookup and the set is small.
    const contactLinks = await prisma.quickBooksEntityLink.findMany({
      where: { companyId: company.id, entityType: "Contact" },
      select: { entityId: true },
    });
    const linkedContactIds = new Set(contactLinks.map((l) => l.entityId));
    winnerHasQuickBooksLink = linkedContactIds.has(contact.id);
    mergeCandidates = others.map((other) => {
      const plan = planContactMerge(contact, other);
      const preview = (f: { key: MergeCandidate["fills"][number]["key"]; label: string; keep: string | null; duplicate: string | null }) => ({
        key: f.key,
        label: f.label,
        keep: f.keep,
        duplicate: f.duplicate,
      });
      return {
        id: other.id,
        name: other.name,
        jobs: other._count.jobs,
        bidInvitations: other._count.bidInvitations,
        interactions: other._count.interactions,
        people: other._count.people,
        hasPortalLink: other.portalToken !== null,
        hasQuickBooksLink: linkedContactIds.has(other.id),
        fills: plan.fills.map(preview),
        conflicts: plan.conflicts.map(preview),
      };
    });
  }

  const enablePortalWithId = enablePortalAccess.bind(null, contact.id);
  const createBidInvitationWithId = createBidInvitation.bind(null, contact.id);

  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-100">Edit contact</h1>
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
      )}

      {showsEstimating && (
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
                  <p className="text-sm text-slate-400">
                    {bid.tradeScope && (
                      <>{TRADE_SCOPE_OPTIONS.find((t) => t.value === bid.tradeScope)?.label} · </>
                    )}
                    {bid.dueDate && <>Due {formatDate(bid.dueDate)}</>}
                  </p>
                  {bid.bidAmount != null && (
                    <p className="text-sm text-slate-300">{money(Number(bid.bidAmount))}</p>
                  )}
                  {bid.notes && <p className="text-sm text-slate-500">{bid.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <form action={updateBidInvitationStatus.bind(null, bid.id)} className="flex items-center gap-2">
                    <select
                      key={bid.status}
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
                    <input
                      name="bidAmount"
                      defaultValue={bid.bidAmount?.toString() ?? ""}
                      placeholder="Bid $"
                      title="Amount bid, once known"
                      className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                    />
                    <SubmitButton
                      type="submit"
                      className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Update
                    </SubmitButton>
                  </form>
                  <form action={deleteBidInvitation.bind(null, bid.id)}>
                    <SubmitButton type="submit" className="text-xs text-red-400 hover:underline">
                      Delete
                    </SubmitButton>
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
            Trade
            <select
              name="tradeScope"
              defaultValue=""
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="">No trade tag</option>
              {TRADE_SCOPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
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
          <SubmitButton
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Log invitation
          </SubmitButton>
        </form>
      </section>
      )}

      {showsEstimating && (
        <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-1 text-lg font-semibold text-slate-100">People</h2>
          <p className="mb-4 text-sm text-slate-400">
            The individuals at {contact.name} -- not a separate account of their own, just who to
            actually call.
          </p>
          {contact.people.length === 0 ? (
            <p className="mb-4 text-sm text-slate-400">No one added at {contact.name} yet.</p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-800 border-y border-slate-800">
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
        <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Interactions</h2>
          <p className="mb-4 text-sm text-slate-400">
            Calls, emails, site visits, and notes with {contact.name} -- a log of the relationship,
            not just the paperwork.
          </p>
          {contact.interactions.length === 0 ? (
            <p className="mb-4 text-sm text-slate-400">No interactions logged with {contact.name} yet.</p>
          ) : (
            <ul className="mb-4 divide-y divide-slate-800 border-y border-slate-800">
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
        <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">QuickBooks</h2>
          <p className="mb-3 text-sm text-slate-400">
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
              <SubmitButton
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Enable client portal
              </SubmitButton>
            </form>
          </div>
        )}
      </section>

      {canMerge && (
        <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Merge a duplicate</h2>
          <MergeContactForm
            winnerId={contact.id}
            winnerName={contact.name}
            winnerHasQuickBooksLink={winnerHasQuickBooksLink}
            candidates={mergeCandidates}
          />
        </section>
      )}

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
                    {showsJobMoney && (
                      <p className="text-sm font-medium text-slate-100">{money(total)}</p>
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
