import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractSummary } from "@/components/ContractSummary";
import { money } from "@/lib/money";
import { invoiceBalanceLabel, balanceToneClass } from "@/lib/invoice-balance-label";
import { PortalJobPhotos } from "@/components/PortalJobPhotos";
import { countJobMedia, loadSharedJobMediaForClient } from "@/lib/job-media-query";
import { viewerTimeZone } from "@/lib/viewerToday";
import { loadPortalContact, loadPortalJob } from "@/lib/portal-query";

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

  // Both reads, and every clause in them, live in lib/portal-query.ts —
  // see that module for what a GC may see and why. Null means the same
  // three things here as on the index (no token, revoked, inactive) and is
  // deliberately one answer, so a dead link learns nothing about itself.
  const contact = await loadPortalContact(token);
  if (!contact) {
    notFound();
  }

  // `contactId` is part of the WHERE rather than a check after the fetch,
  // so a job that is not this contact's never leaves the database.
  const job = await loadPortalJob(contact.id, jobId);
  if (!job) {
    notFound();
  }

  /* THE PHOTO READ SITS BELOW THAT GUARD ON PURPOSE, not beside it in a
     `Promise.all` with the job lookup. `loadPortalJob`'s `contactId` clause
     is the whole of the portal's authorisation — there is no session here,
     the token IS the credential — and the id it validates is the same
     `job.id` the query below filters on. Hoisting these two reads to run
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
  const [photos, sharedPhotoCount] = await Promise.all([
    loadSharedJobMediaForClient(
      { jobId: job.id, companyId: job.companyId, take: PHOTO_LIMIT },
      timeZone,
    ),
    // Through the SAME builder the internal galleries count with, so the
    // "showing 60 of N" line cannot come to disagree with the list above it.
    // `shared: true` here is the same `sharedWithClientAt: { not: null }`
    // the loader applies.
    countJobMedia({ companyId: job.companyId, jobId: job.id, shared: true }),
  ]);

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
            {job.changeOrders.map((co) => (
              <li key={co.id} className="rounded-md border border-line-card bg-surface p-3 text-sm">
                <p className="font-medium text-ink">
                  CO #{co.number}: {co.title}
                </p>
                {co.description && <p className="text-ink-body">{co.description}</p>}
              </li>
            ))}
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
              // THE GC READS THIS PAGE. `Number(invoice.amount) - paid`
              // showed him an amber balance on an invoice he had paid
              // everything currently due on, with no mention of the
              // retainage his own contract withholds. Same function the
              // sub's billing tab uses, so the two sides of the table
              // cannot be shown different arithmetic.
              const balance = invoiceBalanceLabel({
                amount: Number(invoice.amount),
                paidAmount: paid,
                retainageWithheld:
                  invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
                format: money,
              });
              return (
                <li key={invoice.id} className="rounded-md border border-line-card bg-surface p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">
                      Invoice #{invoice.number}
                      {invoice.description ? ` — ${invoice.description}` : ""}
                    </p>
                    <span className={balanceToneClass[balance.tone]}>{balance.headline}</span>
                  </div>
                  <p className="text-ink-body">Amount {money(Number(invoice.amount))}</p>
                  {balance.caption && <p className="text-xs text-ink-muted">{balance.caption}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
