import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { ContactForm } from "@/components/ContactForm";
import { ContactRow } from "@/components/ContactRow";
import { EmptyState } from "@/components/EmptyState";

/**
 * The status chips. Written out here rather than imported from
 * `ContactFields`: that module is "use client", and a constant exported from
 * one reaches a server component as a client-reference proxy, not an array
 * (the Hint.tsx scar in CLAUDE.md). `ContactStatus` in company.prisma is the
 * source; a chip for a status that does not exist would simply count zero
 * and not render.
 */
const STATUS_CHIPS = [
  { value: "ACTIVE", label: "Active" },
  { value: "PROSPECT", label: "Prospects" },
  { value: "INACTIVE", label: "Inactive" },
] as const;
const STATUSES: readonly string[] = STATUS_CHIPS.map((o) => o.value);

function isoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { status } = await searchParams;
  const activeStatus = status && STATUSES.includes(status) ? status : null;

  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          jobs: true,
          bidInvitations: { where: { status: { in: ["INVITED", "SUBMITTED"] } } },
        },
      },
      // The one most recent call, email, visit or note, for "last in touch".
      // Scoped through the contact, which is already scoped to the company.
      interactions: { orderBy: { occurredOn: "desc" }, take: 1, select: { occurredOn: true } },
    },
  });

  // Counted over everyone, never over the filtered view: a chip whose number
  // changes when you press a different chip is not a count.
  const countByStatus = new Map<string, number>();
  for (const contact of contacts) countByStatus.set(contact.status, (countByStatus.get(contact.status) ?? 0) + 1);
  const withJobs = contacts.filter((c) => c._count.jobs > 0).length;
  const openBids = contacts.reduce((sum, c) => sum + c._count.bidInvitations, 0);
  const visible = activeStatus ? contacts.filter((c) => c.status === activeStatus) : contacts;

  const isOwner = currentUser.role === "OWNER";

  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 text-xl font-semibold text-ink">Contacts</h1>
      <p className="mb-6 text-sm text-ink-body">
        Everyone you do work for or buy from — general contractors, developers, architects,
        suppliers and subs — with their jobs, their people and your history with them.
      </p>

      <div className="mb-6" data-tour="contacts-add">
        <ContactForm />
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          data-tour="contacts-empty"
          title="No contacts yet"
          purpose={
            <p>
              Your client list. Add the GCs, developers and suppliers you work with, and each
              one gets a page with their phone and email, their people, every job you have done for
              them, and the calls you have logged.
            </p>
          }
          actions={[
            { label: "Add a contact", opens: "contacts-add" },
            ...(isOwner ? [{ label: "Import from a spreadsheet or Jobber", href: "/settings/import" }] : []),
          ]}
          ask="Add Jane Smith as a contact, phone 555-0142"
          sources={
            <p>
              Anyone you add here, anyone you import, and the client on every new job — start a job
              for someone new and they are added for you.
            </p>
          }
          example={{
            rows: [
              { title: "Jane Smith", tag: "Active", detail: "jane.smith@example.com", meta: "2 jobs" },
              { title: "Northside Builders", tag: "General contractor", detail: "(555) 010-2030", meta: "4 jobs · 1 open bid" },
              { title: "Valley Lumber Supply", tag: "Vendor", detail: "orders@example.com", meta: "0 jobs" },
            ],
          }}
        />
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-3 gap-2 text-center sm:gap-3" data-contacts-summary="">
            <div className="rounded-lg border border-line-card bg-surface p-3">
              <dt className="text-xs text-ink-body">Contacts</dt>
              <dd className="text-lg font-semibold text-ink">{contacts.length}</dd>
            </div>
            <div className="rounded-lg border border-line-card bg-surface p-3">
              <dt className="text-xs text-ink-body">With jobs</dt>
              <dd className="text-lg font-semibold text-ink">{withJobs}</dd>
            </div>
            <div className="rounded-lg border border-line-card bg-surface p-3">
              <dt className="text-xs text-ink-body">Open bids</dt>
              <dd className="text-lg font-semibold text-ink">{openBids}</dd>
            </div>
          </dl>

          <div className="mb-4 flex flex-wrap gap-2" aria-label="Show contacts by status">
            <Link href="/contacts" className={chip(activeStatus === null)}>
              Everyone ({contacts.length})
            </Link>
            {STATUS_CHIPS.filter((o) => (countByStatus.get(o.value) ?? 0) > 0).map((o) => (
              <Link
                key={o.value}
                href={`/contacts?status=${o.value}`}
                className={chip(activeStatus === o.value)}
              >
                {o.label} ({countByStatus.get(o.value)})
              </Link>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-ink-body">
              Nobody with that status.{" "}
              <Link href="/contacts" className="text-link hover:text-link-hover">
                Show everyone
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="contacts-list">
              {visible.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={{
                    id: contact.id,
                    name: contact.name,
                    email: contact.email,
                    phone: contact.phone,
                    status: contact.status,
                    accountType: contact.accountType,
                    jobCount: contact._count.jobs,
                    openBidCount: contact._count.bidInvitations,
                    lastInTouch: isoDate(contact.interactions[0]?.occurredOn),
                  }}
                  canDelete={isOwner}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
