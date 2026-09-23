import Link from "next/link";
import { prisma } from "@prova/db";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { PayApplications, StatusForm } from "@/components/PayApplications";
import { LogPaymentForm } from "@/components/LogPaymentForm";
import { PushPaymentToQuickBooks } from "@/components/PushPaymentToQuickBooks";
import { PushInvoiceToQuickBooks } from "@/components/PushInvoiceToQuickBooks";
import { pushBlockers } from "@/lib/quickbooks-sync";
import { paymentPushBlockers } from "@/lib/quickbooks-payment-sync";
import { accountPurpose } from "@/lib/quickbooks-constants";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { viewerTimeZone } from "@/lib/viewerToday";
import { formatCalendarDate } from "@/lib/render-date";
import { cashReceived } from "@/lib/billing/payment-entry";
import { money } from "@/lib/money";
import { invoiceBalanceLabel, balanceToneClass } from "@/lib/invoice-balance-label";
import { SubmitButton } from "@/components/SubmitButton";
import { createInvoice, deletePayment } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

/**
 * Billing — invoices, payments and pay applications. Withheld on
 * MANAGE_BILLING exactly like the monolith's own `!isEstimateStage &&
 * showsBilling` — a SOFT gate, same reasoning as the Estimate tab's own
 * doc comment: `lib/action-capability-guards.test.ts` found that this
 * tab's write actions are not independently guarded on MANAGE_BILLING
 * (only reachable from the monolith's open `/jobs/[id]` before this
 * rebuild), so a hard `requireCapability`/`<NoAccess>` wall here would
 * claim a boundary the action layer does not enforce. Tracked in issue
 * #383 (Diego's lane) rather than fixed in a layout PR; the issue's own
 * detail is held privately since it names exactly what is unguarded on a
 * public repo.
 */
export default async function JobBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company, principal, job: jobRef } = await requireJob(id);
  const { showsBilling } = jobCapabilities(principal);
  if (!showsBilling) {
    return <p className="text-sm text-ink-muted">This tab isn&rsquo;t part of your access.</p>;
  }

  if (jobRef.status === "ESTIMATE") {
    return (
      <p className="text-sm text-ink-muted">
        This job is still an estimate — invoices and pay applications open up once it&rsquo;s contracted.
      </p>
    );
  }

  const job = await prisma.job.findUnique({
    where: { id: jobRef.id },
    include: {
      contact: { select: { id: true } },
      lineItems: { where: { isDeleted: false }, select: { id: true, description: true, quantity: true, unitPrice: true } },
      invoices: {
        orderBy: { number: "asc" },
        include: { payments: { orderBy: { receivedAt: "desc" } }, lineItems: true },
      },
    },
  });
  if (!job) throw new Error("job disappeared between checks");

  const [quickBooksConnection, jobCustomerLink, incomeAccountMapping] = await Promise.all([
    prisma.quickBooksConnection.findUnique({ where: { companyId: company.id } }),
    prisma.quickBooksEntityLink.findUnique({
      where: { companyId_entityType_entityId: { companyId: company.id, entityType: "Contact", entityId: job.contactId } },
      select: { qboId: true },
    }),
    prisma.quickBooksAccountMapping.findUnique({
      where: { companyId_purpose: { companyId: company.id, purpose: accountPurpose("INCOME") } },
      select: { qboAccountId: true },
    }),
  ]);
  const quickBooksUsable = quickBooksConnection !== null && quickBooksConnection.status !== "NEEDS_REAUTH";

  const quickBooksInvoiceLinks = new Map(
    (
      await prisma.quickBooksEntityLink.findMany({
        where: { companyId: company.id, entityType: "Invoice", entityId: { in: job.invoices.map((invoice) => invoice.id) } },
        select: { entityId: true, qboId: true, lastVerifiedAt: true },
      })
    ).map((link) => [
      link.entityId,
      { qboId: link.qboId, lastVerifiedAt: link.lastVerifiedAt ? link.lastVerifiedAt.toISOString().slice(0, 10) : null },
    ]),
  );

  const quickBooksPaymentLinks = new Map(
    (
      await prisma.quickBooksEntityLink.findMany({
        where: {
          companyId: company.id,
          entityType: "Payment",
          entityId: { in: job.invoices.flatMap((invoice) => invoice.payments.map((p) => p.id)) },
        },
        select: { entityId: true, qboId: true, lastVerifiedAt: true },
      })
    ).map((link) => [
      link.entityId,
      { qboId: link.qboId, lastVerifiedAt: link.lastVerifiedAt ? link.lastVerifiedAt.toISOString().slice(0, 10) : null },
    ]),
  );

  const payApplications = job.invoices
    .filter((invoice) => invoice.lineItems.length > 0)
    .map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amount: Number(invoice.amount),
      issuedAt: invoice.issuedAt.toISOString(),
    }));
  const payApplicationLineItemOptions = job.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    scheduledValue: Number(item.quantity) * Number(item.unitPrice ?? 0),
    materialsStoredToDate: job.invoices.reduce(
      (sum, invoice) =>
        sum +
        invoice.lineItems.filter((row) => row.lineItemId === item.id).reduce((rowSum, row) => rowSum + Number(row.materialsStoredValue), 0),
      0,
    ),
    // Summed the same way, and needed for the same kind of reason: the
    // percent-complete box converts "60%" into THIS period's dollars, which
    // is 60% of the line minus what has already gone out on it. Without
    // this the box would bill the whole 60% again every month.
    previousBilled: job.invoices.reduce(
      (sum, invoice) =>
        sum +
        invoice.lineItems.filter((row) => row.lineItemId === item.id).reduce((rowSum, row) => rowSum + Number(row.thisPeriodBilled), 0),
      0,
    ),
  }));

  const timeZone = await viewerTimeZone();
  const createInvoiceWithId = createInvoice.bind(null, job.id);

  return (
    <div>
      <section className="mb-10" data-tour="job-invoices">
        <h2 className="mb-3 text-lg font-semibold text-ink">Invoices</h2>
        <div className="flex flex-col gap-4">
          {job.invoices.map((invoice) => {
            const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
            // ONE definition of "balance", shared with /cash-flow, the
            // Today receivables tile and the GC's portal. This line used
            // to be `Number(invoice.amount) - paid` — gross, float, and
            // painted amber — so an invoice paid to its net-of-retainage
            // amount showed the sub a debt he was not owed with the
            // log-a-payment form open beneath it.
            const balance = invoiceBalanceLabel({
              amount: Number(invoice.amount),
              paidAmount: paid,
              retainageWithheld:
                invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
              format: money,
            });
            return (
              <div key={invoice.id} className="rounded-lg border border-line-card bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink">
                    Invoice #{invoice.number}
                    {invoice.description ? ` — ${invoice.description}` : ""}
                  </p>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-ink-body">Amount {money(Number(invoice.amount))}</span>
                    <span className="text-ink-body">Paid {money(paid)}</span>
                    <span className={balanceToneClass[balance.tone]}>{balance.headline}</span>
                    <StatusForm jobId={job.id} invoiceId={invoice.id} status={invoice.status} />
                    <PushInvoiceToQuickBooks
                      invoiceId={invoice.id}
                      linkedQboId={quickBooksInvoiceLinks.get(invoice.id)?.qboId ?? null}
                      lastVerifiedAt={quickBooksInvoiceLinks.get(invoice.id)?.lastVerifiedAt ?? null}
                      blockers={pushBlockers({
                        hasConnection: quickBooksUsable,
                        customerQboId: jobCustomerLink?.qboId ?? null,
                        incomeAccountId: incomeAccountMapping?.qboAccountId ?? null,
                        totalCents: Math.round(Number(invoice.amount) * 100),
                      })}
                    />
                  </div>
                </div>
                {invoice.lineItems.length > 0 && (
                  <Link href={`/jobs/${job.id}/pay-applications/${invoice.id}`} className="mt-1 inline-block text-xs text-link hover:underline">
                    View pay application →
                  </Link>
                )}
                {invoice.dueAt && <p className="mt-1 text-xs text-ink-muted">Due {formatCalendarDate(invoice.dueAt)}</p>}
                {/* The retainage figure and the balance it explains now
                    come from the same call, so the page cannot print one
                    without the other. */}
                {balance.caption && (
                  <p className="mt-1 text-xs text-ink-muted">{balance.caption}</p>
                )}

                {invoice.payments.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 border-t border-line-row pt-3">
                    {invoice.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink-label">
                          {formatCalendarDate(payment.receivedAt, "dayMonth")}
                          {payment.method ? ` · ${payment.method}` : ""}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </span>
                        <span className="flex items-center gap-2">
                          {payment.feeAmount != null && (
                            <span className="text-xs text-ink-muted">
                              {money(Number(payment.feeAmount))} fee
                              {payment.feeSource ? ` (${payment.feeSource})` : ""} ·{" "}
                              {money(cashReceived(Number(payment.amount), Number(payment.feeAmount)))} banked
                            </span>
                          )}
                          <span className="text-ink">{money(Number(payment.amount))}</span>
                          {/* Owner-only (#351): `deletePayment` asserts it and would
                              answer a non-owner with a redacted digest, so the
                              control is withheld rather than refused after the
                              click — the same split the catalog page documents.
                              The QuickBooks push inside stays visible to every
                              MANAGE_BILLING holder, as before. */}
                          <RowActions
                            as="span"
                            className="flex shrink-0 items-center justify-end gap-2"
                            destructive={
                              principal.role === "OWNER" ? (
                              <ConfirmDelete
                                pinned="end"
                                action={deletePayment.bind(null, job.id, payment.id)}
                                describe="Un-records money you had marked as received. Cash collected and the invoice's balance both move. Nothing is returned to the GC — this only corrects your books."
                                label="Remove"
                                confirmLabel="Confirm remove"
                                deleteClassName={rowDeleteClass}
                                cancelClassName={rowCancelClass}
                                confirmClassName={rowConfirmClass}
                                hint={
                                  <span className="max-w-[16rem] text-right text-amber-300">
                                    {money(Number(payment.amount))} received comes off this invoice, and the balance
                                    goes back up.
                                  </span>
                                }
                              />
                              ) : null
                            }
                          >
                            <PushPaymentToQuickBooks
                              paymentId={payment.id}
                              linkedQboId={quickBooksPaymentLinks.get(payment.id)?.qboId ?? null}
                              lastVerifiedAt={quickBooksPaymentLinks.get(payment.id)?.lastVerifiedAt ?? null}
                              blockers={paymentPushBlockers({
                                hasConnection: quickBooksUsable,
                                customerQboId: jobCustomerLink?.qboId ?? null,
                                invoiceQboId: quickBooksInvoiceLinks.get(invoice.id)?.qboId ?? null,
                                amountCents: Math.round(Number(payment.amount) * 100),
                              })}
                            />
                          </RowActions>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* GROSS, deliberately, and unchanged: `logPayment`'s
                    ceiling is `amount - paidAmount` because a GC is
                    entitled to pay retainage early and the ledger has to
                    accept the cash that arrives. What changed is that the
                    line above no longer calls that remainder a debt.
                    Only the two tones where the GC still has money to send:
                    not a credit (the GC is owed money back, and a payment
                    row against one makes the correction look settled) and
                    not an overpayment (more cash is the wrong answer). */}
                {(balance.tone === "owing" || balance.tone === "retainage-only") && (
                  <LogPaymentForm jobId={job.id} invoiceId={invoice.id} />
                )}
              </div>
            );
          })}
        </div>

        <ActionForm action={createInvoiceWithId} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-line-card bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Description
            <input
              name="description"
              placeholder="Deposit, final payment, etc."
              className="w-56 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Amount
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              required
              className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Due date
            <input
              type="date"
              name="dueAt"
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
            />
          </label>
          <SubmitButton type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500">
            Create invoice
          </SubmitButton>
        </ActionForm>
      </section>

      <PayApplications jobId={job.id} lineItems={payApplicationLineItemOptions} payApplications={payApplications} timeZone={timeZone} />
    </div>
  );
}
