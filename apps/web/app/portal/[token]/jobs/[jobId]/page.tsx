import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractSummary } from "@/components/ContractSummary";
import { prisma } from "@prova/db";
import { money, signedMoney } from "@/lib/money";
import { changeOrderValueDelta } from "@/lib/change-order";
import {
  formatOverheadAndProfitAmount,
  overheadAndProfitBlock,
  overheadAndProfitLineLabel,
} from "@/lib/overhead-and-profit";
import { PortalJobPhotos } from "@/components/PortalJobPhotos";
import { countJobMedia, loadSharedJobMediaForClient } from "@/lib/job-media-query";
import { viewerTimeZone } from "@/lib/viewerToday";
import { isPortalAccessRevoked, CLIENT_VISIBLE_CHANGE_ORDER_STATUS } from "@/lib/access-tokens";
import { scopeSections } from "@/lib/change-order-scope";
import { ScopeSectionList } from "@/components/ScopeSectionList";

/** The photo cap, matching `/photos`. A GC scrolling a job's history wants
 * the same generous page the sub gets, and this section is at the bottom of
 * an already long page. */
const PHOTO_LIMIT = 60;

export default async function PortalJobPage({
  params,
}: {
  params: Promise<{ token: string; jobId: string }>;
}) {
  const { token, jobId } = await params;

  const contact = await prisma.contact.findUnique({ where: { portalToken: token } });
  // Issue #106 finding 2: a revoked link, and a contact the sub has set
  // INACTIVE (a PM who left, a relationship that's over), read exactly
  // like a token that never existed — 404, not a different error shape.
  // Distinguishing "revoked" from "never was" would tell whoever is
  // holding a dead link that it once worked, which the portal's existing
  // "wrong jobId 404s" convention already treats as worth avoiding.
  if (!contact || isPortalAccessRevoked(contact)) {
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
      // Issue #106 finding 1: APPROVED only. Every other read site treats
      // a change order as live scope only once the GC has agreed to it
      // (see ChangeOrderStatus's own comment in jobs.prisma) — DRAFT is
      // the sub's own unsent internal note, SUBMITTED is a pending ask,
      // REJECTED and VOID are things that didn't happen. None of that is
      // the sub's to show a GC, and VOID/REJECTED numbers would also
      // expose gaps in the sequence with no context for why.
      changeOrders: {
        where: { status: CLIENT_VISIBLE_CHANGE_ORDER_STATUS },
        orderBy: { number: "asc" },
        // Both joins are here because the GC's copy is one document, and
        // the two halves are worthless apart. `proposals` carries the
        // subtotal / overhead-and-profit / total block the sub sees on
        // /jobs/[id]; `scopeNotes` carries what the price does and does not
        // cover. A price with no scope is a number to argue with, and an
        // exclusion with no price is a note to self — the GC was previously
        // shown neither, just a title, on the one page built for them to
        // read the money on. Locked by the time it gets here: notes are
        // draft-only to edit, and this query is APPROVED-only.
        include: {
          edits: true,
          proposals: { orderBy: { createdAt: "asc" } },
          scopeNotes: true,
        },
      },
      // `revokedAt: null` and the `expiresAt` clause: don't hand the GC a
      // "Review and sign" link to a request that will 404 the moment they
      // click it — see issue #106 finding 2.
      signatureRequests: {
        where: { status: "PENDING", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
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

  /* THE PHOTO READ SITS BELOW THAT GUARD ON PURPOSE, not beside it in a
     `Promise.all` with the job lookup. `job.contactId !== contact.id` is
     the whole of the portal's authorisation — there is no session here, the
     token IS the credential — and the id it validates is the same `job.id`
     the query below filters on. Hoisting these two reads to run
     concurrently would mean the photos of a job this contact does not own
     were fetched before anything established that they own it, which is the
     shape of bug that becomes a leak the first time somebody moves a
     `notFound()`.

     `companyId` is passed as well; see `loadSharedJobMediaForClient` for why
     it is belt-and-braces rather than redundant, and for the
     `sharedWithClientAt: { not: null }` clause that is the entire opt-in.

     The ZONE is honest about what it can know. `/portal` renders no
     `TimeZoneCookie` — that lives in the signed-in layout — so for a GC
     this resolves to Vercel's geo-IP header, or UTC locally and on the
     first request from a brand-new browser. A wrong-by-an-hour capture time
     on a client page is a cost worth naming; the alternative is formatting
     in the browser during render, which is the hydration break
     components/localToday.ts exists to warn about. */
  const timeZone = await viewerTimeZone();
  const [photos, sharedPhotoCount, changeOrderTargetRows] = await Promise.all([
    loadSharedJobMediaForClient(
      { jobId: job.id, companyId: job.companyId, take: PHOTO_LIMIT },
      timeZone,
    ),
    // Through the SAME builder the internal galleries count with, so the
    // "showing 60 of N" line cannot come to disagree with the list above it.
    // `shared: true` here is the same `sharedWithClientAt: { not: null }`
    // the loader applies.
    countJobMedia({ companyId: job.companyId, jobId: job.id, shared: true }),
    /* The UNFILTERED line items, for the change-order arithmetic below —
       the shape `changeOrderValueDelta` documents for its `targets` map,
       and the same read /jobs/[id] does for the same purpose.
       Every change order this page shows is APPROVED, so every proposal on
       it carries the snapshot of what it replaced and the map is never
       actually consulted. It is built anyway rather than passed as an empty
       Map: "it happens not to be read today" is the kind of load-bearing
       coincidence that turns into a wrong number on the GC's copy the first
       time this page is allowed to show a pending change order.
       Below the `job.contactId !== contact.id` guard for the reason spelled
       out above — the token IS the credential here. */
    prisma.jobLineItem.findMany({
      where: { jobId: job.id },
      select: { id: true, quantity: true, unitPrice: true, isDeleted: true },
    }),
  ]);

  const changeOrderTargets = new Map(changeOrderTargetRows.map((row) => [row.id, row]));

  const pendingSignature = job.signatureRequests[0];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/portal/${token}`} className="mb-6 inline-block text-sm text-link hover:underline">
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
                className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
              >
                Review and sign contract
              </Link>
            ) : undefined
          }
        />
      </div>

      {job.changeOrders.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-ink">Change orders</h2>
          <ul className="flex flex-col gap-2">
            {job.changeOrders.map((co) => {
              /* Subtotal, overhead and profit, total — the same three lines
                 the sub sees on /jobs/[id], through the same module, so the
                 two copies of this document cannot print different numbers.
                 An unset rate reads "Not set" rather than $0.00 here too:
                 the GC is entitled to see that the total in front of them
                 has no markup in it, rather than a zero that looks decided. */
              const block = overheadAndProfitBlock(
                changeOrderValueDelta(co.proposals, changeOrderTargets),
                co.overheadAndProfitPercent,
              );
              return (
                <li key={co.id} className="rounded-md border border-line-card bg-surface p-3 text-sm">
                  <p className="font-medium text-ink">
                    CO #{co.number}: {co.title}
                  </p>
                  {co.description && <p className="text-ink-body">{co.description}</p>}
                  {/* Scope BEFORE the money, deliberately, and this is the one
                      ordering decision in this merge that is not a union of
                      two sides. A total read before its exclusions is a number
                      to argue with; read after them it is a priced scope. The
                      split is by kind AND rendered by a shared component,
                      which is the half that used to be missing: the splitter
                      was shared and the markup was hand-rolled here, so
                      deleting the headings on the GC's copy passed every test
                      in the repo. ScopeSectionList is mounted and asserted
                      against. */}
                  <ScopeSectionList sections={scopeSections(co.scopeNotes)} />
                  <dl className="mt-2 flex flex-col gap-1 border-t border-line-row pt-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-body">Subtotal</dt>
                      <dd className="tabular-nums text-ink-label">
                        {signedMoney(Number(block.subtotal))}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className={block.isSet ? "text-ink-body" : "text-ink-muted"}>
                        {overheadAndProfitLineLabel(block.percent)}
                      </dt>
                      <dd
                        className={
                          block.isSet
                            ? "tabular-nums text-ink-label"
                            : "text-xs uppercase tracking-wide text-ink-muted"
                        }
                      >
                        {block.isSet
                          ? signedMoney(Number(block.amount))
                          : formatOverheadAndProfitAmount(block)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-line-row pt-1">
                      <dt className="font-semibold text-ink">Total</dt>
                      <dd className="font-semibold tabular-nums text-ink">
                        {signedMoney(Number(block.total))}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Contract, then what changed, then what it looked like, then what is
          owed. The photos go here rather than at the end because they are
          the evidence the two money sections are arguments about — a change
          order and an invoice both read differently once you have seen the
          wall. It renders nothing at all when nothing has been shared. */}
      <PortalJobPhotos photos={photos} total={sharedPhotoCount} limit={PHOTO_LIMIT} />

      {job.invoices.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">Invoices</h2>
          <ul className="flex flex-col gap-2">
            {job.invoices.map((invoice) => {
              const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
              const balance = Number(invoice.amount) - paid;
              return (
                <li key={invoice.id} className="rounded-md border border-line-card bg-surface p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">
                      Invoice #{invoice.number}
                      {invoice.description ? ` — ${invoice.description}` : ""}
                    </p>
                    <span className={balance <= 0 ? "text-green-400" : "text-amber-400"}>
                      {balance <= 0 ? "Paid in full" : `Balance ${money(balance)}`}
                    </span>
                  </div>
                  <p className="text-ink-body">Amount {money(Number(invoice.amount))}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
