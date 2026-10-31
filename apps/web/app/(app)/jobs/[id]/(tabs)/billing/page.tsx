import Link from "next/link";
import { prisma } from "@prova/db";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { PayApplications, StatusForm } from "@/components/PayApplications";
import { estimatedHours } from "@/lib/labor-productivity";
import { LogPaymentForm } from "@/components/LogPaymentForm";
import { PushPaymentToQuickBooks } from "@/components/PushPaymentToQuickBooks";
import { PushInvoiceToQuickBooks } from "@/components/PushInvoiceToQuickBooks";
import { pushBlockers } from "@/lib/quickbooks-sync";
import { paymentPushBlockers } from "@/lib/quickbooks-payment-sync";
import { accountPurpose } from "@/lib/quickbooks-constants";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { viewerAsOf, viewerTimeZone } from "@/lib/viewerToday";
import { dueStatus } from "@/lib/due-date";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { CollapsedForm } from "@/components/CollapsedForm";
import { Disclosure } from "@/components/Disclosure";
import { SeeAll, seeAllWindow } from "@/components/SeeAll";
import { cashReceived } from "@/lib/billing/payment-entry";
import { money } from "@/lib/money";
import { invoiceBalanceLabel, balanceToneClass } from "@/lib/invoice-balance-label";
import { SubmitButton } from "@/components/SubmitButton";
import { createInvoice, deletePayment } from "@/lib/actions";
import { LienWaivers } from "@/components/LienWaivers";
import { loadLienWaiverSection, loadLowerTierWaiverInputs } from "@/lib/lien-waiver-query";
import { missingLowerTierWaivers, waiverOfferFor } from "@/lib/lien-waiver-followups";
import { ActionForm } from "@/components/ActionForm";
import { PayAppSummary } from "@/components/job/PayAppSummary";
import { billingNoun } from "@/components/job/jobStages";
import { payAppFigures, payAppMonth } from "@/components/job/payAppFigures";
import { loadPayApplication } from "@/lib/pay-application-query";

/** "PARTIALLY_PAID" → "Partially paid": the same words StatusForm's select
 * shows, for the closed row's summary line. A label only. */
const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replace("_", " ");

const rowDeleteClass = "text-xs text-danger hover:underline";
const rowCancelClass =
  "rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:border-line-card";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-danger hover:bg-red-500/10";

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
export default async function JobBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ all?: string }>;
}) {
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
      contact: { select: { id: true, name: true } },
      lineItems: {
        where: { isDeleted: false },
        select: { id: true, description: true, quantity: true, unitPrice: true, laborHours: true, productionRate: true },
      },
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
  // Per day, so the form can stop at whatever period-to date is typed.
  const loggedByLine = await prisma.timeEntry.groupBy({
    by: ["lineItemId", "date"],
    where: { jobId: job.id, lineItemId: { not: null } },
    _sum: { hours: true },
  });
  const payApplicationLineItemOptions = job.lineItems.map((item) => ({
    budgeted: estimatedHours({
      laborHours: item.laborHours == null ? null : Number(item.laborHours),
      quantity: Number(item.quantity),
      productionRate: item.productionRate == null ? null : Number(item.productionRate),
    }),
    logged: loggedByLine
      .filter((row) => row.lineItemId === item.id)
      .map((row) => ({ day: row.date.toISOString().slice(0, 10), amount: Number(row._sum.hours ?? 0) })),
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
  // The reader's calendar day, for "overdue N days" (lib/due-date.ts).
  const asOf = await viewerAsOf();
  const createInvoiceWithId = createInvoice.bind(null, job.id);

  const lienWaiverSection = await loadLienWaiverSection(job.id);
  // The lower-tier check (lib/lien-waiver-followups.ts): one read of who the
  // sub buys from on this job and what waivers have come in, composed per
  // application below against the PREVIOUS application's period.
  const lowerTierInputs = await loadLowerTierWaiverInputs(job.id);

  // The summary at the top is the LATEST pay application, read through
  // loadPayApplication — the same certificate its Review page prints — so
  // the two cannot show different figures.
  const latestPayApp = payApplications.at(-1);
  const latestCertificate = latestPayApp ? await loadPayApplication(job.id, latestPayApp.id, company.id) : null;
  // The counter, not max(number)+1 (CLAUDE.md, sequence numbers): it is
  // what the next submit will actually issue. A read only — the bump stays
  // in issueInvoiceNumber's transaction.
  const invoiceCounter = await prisma.invoiceCounter.findUnique({ where: { jobId: job.id }, select: { lastNumber: true } });
  const latestInvoice = latestPayApp ? job.invoices.find((invoice) => invoice.id === latestPayApp.id) : undefined;

  // THE WAIVER OFFER for the newest pay application with no waiver yet:
  // amount = its current payment due (G702 line 8), through = its period-to.
  const waiverOffer =
    latestInvoice && latestCertificate?.isPayApplication
      ? waiverOfferFor({
          invoiceId: latestInvoice.id,
          number: latestInvoice.number,
          currentPaymentDue: latestCertificate.summary.currentPaymentDue,
          periodTo: latestInvoice.periodTo,
          hasWaiver: lienWaiverSection.waivers.some((w) => w.invoiceId === latestInvoice.id && w.revokedAt === null),
        })
      : null;

  // THE LOWER-TIER WARNING per application: the period the previous
  // application ran through (its period-to, or its issue day when it has
  // none) against the inbound waivers. Keyed by invoice id for the rows.
  const payAppsAsc = job.invoices.filter((invoice) => invoice.lineItems.length > 0);
  const lowerTierWarningByInvoice = new Map<string, string>();
  payAppsAsc.forEach((invoice, index) => {
    const previous = index > 0 ? payAppsAsc[index - 1] : null;
    const check = missingLowerTierWaivers({
      previousPeriodTo: previous ? (previous.periodTo ?? previous.issuedAt) : null,
      parties: lowerTierInputs.parties,
      inbound: lowerTierInputs.inbound,
    });
    if (check.warning) lowerTierWarningByInvoice.set(invoice.id, check.warning);
  });

  // Why each QuickBooks button is off — the same two calls, with the same
  // arguments, each button below still makes for itself; repeated here only
  // so the page can see every list at once. A sentence EVERY button carries
  // ("QuickBooks isn't connected.") is said once above the list instead of
  // under each invoice and each payment (four times on Riverside). The
  // buttons still receive their full lists, so what is disabled is unchanged;
  // `shownAbove` only drops the repeated sentence from the note beside them.
  const blockerLists = job.invoices.flatMap((invoice) => [
    pushBlockers({
      hasConnection: quickBooksUsable,
      customerQboId: jobCustomerLink?.qboId ?? null,
      incomeAccountId: incomeAccountMapping?.qboAccountId ?? null,
      totalCents: Math.round(Number(invoice.amount) * 100),
    }),
    ...invoice.payments.map((payment) =>
      paymentPushBlockers({
        hasConnection: quickBooksUsable,
        customerQboId: jobCustomerLink?.qboId ?? null,
        invoiceQboId: quickBooksInvoiceLinks.get(invoice.id)?.qboId ?? null,
        amountCents: Math.round(Number(payment.amount) * 100),
      }),
    ),
  ]);
  // Only lifted when there are two or more buttons: one button's own reasons
  // read better beside it than above a list.
  const sharedBlockers =
    blockerLists.length > 1 ? blockerLists[0].filter((blocker) => blockerLists.every((list) => list.includes(blocker))) : [];

  // One list, newest last, capped at the latest few with "See all" (?all=1).
  // A slice of what was loaded, never a narrower query: every row stays one
  // click away.
  const noun = billingNoun(company.filesMonthlyPayApps);
  const { limit, showingAll } = seeAllWindow((await searchParams)?.all);
  const shownInvoices = showingAll ? job.invoices : job.invoices.slice(-limit);
  const newestInvoiceId = job.invoices.at(-1)?.id;

  return (
    <div>
      <PayAppSummary
        jobId={job.id}
        gcName={job.contact.name}
        nextNumber={(invoiceCounter?.lastNumber ?? 0) + 1}
        asOf={asOf}
        payApp={
          latestPayApp && latestInvoice && latestCertificate
            ? {
                id: latestPayApp.id,
                number: latestPayApp.number,
                month: payAppMonth(latestInvoice.issuedAt, timeZone, asOf),
                dueAt: latestInvoice.dueAt,
                status: latestPayApp.status,
                figures: payAppFigures(latestCertificate),
              }
            : null
        }
      />

      {/* ONE list of invoices and pay applications. It used to be two: every
          invoice as a card here, then the same pay applications again further
          down (PayApplications.tsx), each with its own status select. A pay
          application IS an invoice with line items, so this list — every
          invoice on the job — already holds every pay application; what the
          second list had that this one lacked (the "Application #N" link and
          the issued date) is on the row now. One row per invoice, one status
          control each; the newest opens, the rest are one line. */}
      <section className="mb-10" data-tour="job-invoices">
        <h2 className="mb-3 text-lg font-semibold text-ink">{noun.many}</h2>
        {sharedBlockers.length > 0 && (
          <p className="mb-3 text-sm text-ink-muted">
            {sharedBlockers.join(" ")} The QuickBooks buttons below stay off until that&rsquo;s sorted —{" "}
            <Link href="/settings?tab=quickbooks" className="text-link hover:text-link-hover hover:underline">
              QuickBooks settings
            </Link>
            .
          </p>
        )}
        {payApplications.length === 0 && (
          <p className="mb-3 text-sm text-ink-body">No pay applications submitted yet.</p>
        )}
        <div className="border-t border-line-row">
          {shownInvoices.map((invoice) => {
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
              <Disclosure
                key={invoice.id}
                variant="row"
                name="pay-app"
                open={invoice.id === newestInvoiceId}
                summary={
                  // The closed row answers "which one, how much, where is it,
                  // when is it due" — an overdue date stays red here, so a
                  // closed row still shows what needs chasing.
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-ink">
                      {noun.one} #{invoice.number}
                      {invoice.description ? ` — ${invoice.description}` : ""}
                    </span>
                    <span className="tabular-nums text-ink-body">· {money(Number(invoice.amount))}</span>
                    <span className="text-ink-body">· {statusLabel(invoice.status)}</span>
                    {invoice.dueAt && (invoice.status !== "PAID" && dueStatus(invoice.dueAt, asOf).overdue ? (
                      <span className="font-semibold text-danger">
                        · Due {formatCalendarDate(invoice.dueAt)} · {dueStatus(invoice.dueAt, asOf).text}
                      </span>
                    ) : (
                      <span className="text-ink-muted">· Due {formatCalendarDate(invoice.dueAt)}</span>
                    ))}
                  </span>
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    {invoice.lineItems.length > 0 && (
                      <p className="text-ink-muted">
                        <Link href={`/jobs/${job.id}/pay-applications/${invoice.id}`} className="text-link hover:underline">
                          Application #{invoice.number}
                        </Link>
                        {" · issued "}
                        {formatInstant(invoice.issuedAt, timeZone)}
                        {invoice.periodTo ? ` · period to ${formatCalendarDate(invoice.periodTo)}` : ""}
                        {" · "}
                        <Link href={`/jobs/${job.id}/pay-applications/${invoice.id}`} className="text-link hover:underline">
                          View pay application →
                        </Link>
                      </p>
                    )}
                    <p className="flex flex-wrap items-baseline gap-x-4">
                      <span className="text-ink-body">Paid {money(paid)}</span>
                      <span className={balanceToneClass[balance.tone]}>{balance.headline}</span>
                    </p>
                    {/* Before this goes to the GC. Advisory, never blocking,
                        and never an all-clear: it only ever names who has
                        NOT sent a waiver for the previous period. */}
                    {lowerTierWarningByInvoice.has(invoice.id) && (
                      <p className="max-w-xl text-xs text-warn">
                        {lowerTierWarningByInvoice.get(invoice.id)}{" "}
                        <Link href="/compliance" className="text-link hover:underline">
                          Compliance →
                        </Link>
                      </p>
                    )}
                  </div>
                  <div className="flex items-start gap-4">
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
                      shownAbove={sharedBlockers}
                    />
                  </div>
                </div>
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
                          <RowActions
                            as="span"
                            className="flex shrink-0 items-center justify-end gap-2"
                            destructive={
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
                                  <span className="max-w-[16rem] text-right text-warn">
                                    {money(Number(payment.amount))} received comes off this invoice, and the balance
                                    goes back up.
                                  </span>
                                }
                              />
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
                              shownAbove={sharedBlockers}
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
              </Disclosure>
            );
          })}
        </div>
        <SeeAll total={job.invoices.length} limit={limit} showingAll={showingAll} noun={noun.lowerMany} />

        {/* Anchor for older links here. The summary's "Start pay app" uses
            NEW_PAY_APP_HASH, which PayApplications opens and focuses itself. */}
        <div id="pay-applications" className="mt-4 flex scroll-mt-6 flex-col gap-3">
          <PayApplications jobId={job.id} lineItems={payApplicationLineItemOptions} />
          <CollapsedForm label="Create invoice" tone="secondary">
            <ActionForm action={createInvoiceWithId} className="flex flex-wrap items-end gap-3 rounded-lg border border-line-card bg-surface p-4">
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
          </CollapsedForm>
        </div>
      </section>

      <LienWaivers jobId={job.id} section={lienWaiverSection} canManage={showsBilling} offer={waiverOffer} />
    </div>
  );
}
