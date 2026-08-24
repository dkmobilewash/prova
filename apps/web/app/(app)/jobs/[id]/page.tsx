import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { ContractSummary } from "@/components/ContractSummary";
import { WipNarrativeButton } from "@/components/WipNarrativeButton";
import { money } from "@/lib/money";
import { calculateLineItemWip, calculateJobWip } from "@/lib/wip";
import {
  addChangeOrderLineItem,
  addCostEntry,
  addLineItem,
  assignCrewMember,
  createInvoice,
  createSignatureRequest,
  deleteCostEntry,
  deleteLineItem,
  deletePayment,
  editLineItemViaChangeOrder,
  logPayment,
  markJobContracted,
  removeLineItemViaChangeOrder,
  unassignCrewMember,
  updateJobSchedule,
  updateLineItem,
  updateLineItemForecast,
} from "@/lib/actions";

const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;
const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

function dateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company } = await requireCompanyContext();

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      contact: true,
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: {
          originChangeOrder: true,
          costEntries: { orderBy: { incurredAt: "desc" } },
        },
      },
      changeOrders: {
        orderBy: { number: "asc" },
        include: { edits: true },
      },
      assignments: {
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
      signatureRequests: {
        orderBy: { createdAt: "desc" },
      },
      invoices: {
        orderBy: { number: "asc" },
        include: { payments: { orderBy: { receivedAt: "desc" } } },
      },
    },
  });

  if (!job || job.companyId !== company.id) {
    notFound();
  }

  const companyMembers = await prisma.user.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "asc" },
  });
  const assignedUserIds = new Set(job.assignments.map((a) => a.userId));
  const unassignedMembers = companyMembers.filter((m) => !assignedUserIds.has(m.id));

  const isEstimateStage = job.status === "ESTIMATE";

  // Percentage-of-completion WIP, cost-to-cost method — see lib/wip.ts.
  // jobWip.contractValue / jobWip.actualCostToDate are the single source of
  // truth for "total estimated" / "total actual" below — no separate
  // duplicate computation.
  const lineItemWip = job.lineItems.map((item) => ({
    item,
    wip: calculateLineItemWip({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
      currentEstimatedUnitCost:
        item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
      estimatedCostToComplete:
        item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
      actualCostToDate: item.costEntries.reduce((s, entry) => s + Number(entry.amount), 0),
    }),
  }));
  const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const jobWip = calculateJobWip(
    lineItemWip.map((l) => l.wip),
    billedToDate,
  );

  const addLineItemWithId = addLineItem.bind(null, job.id);
  const updateLineItemWithId = (lineItemId: string) => updateLineItem.bind(null, job.id, lineItemId);
  const updateLineItemForecastWithId = (lineItemId: string) =>
    updateLineItemForecast.bind(null, job.id, lineItemId);
  const deleteLineItemWithId = (lineItemId: string) => deleteLineItem.bind(null, job.id, lineItemId);
  const addChangeOrderWithId = addChangeOrderLineItem.bind(null, job.id);
  const editViaChangeOrderWithId = editLineItemViaChangeOrder.bind(null, job.id);
  const removeViaChangeOrderWithId = removeLineItemViaChangeOrder.bind(null, job.id);
  const markContractedWithId = markJobContracted.bind(null, job.id);
  const addCostEntryWithId = (lineItemId: string) => addCostEntry.bind(null, job.id, lineItemId);
  const deleteCostEntryWithId = (costEntryId: string) => deleteCostEntry.bind(null, job.id, costEntryId);
  const updateScheduleWithId = updateJobSchedule.bind(null, job.id);
  const assignCrewWithId = assignCrewMember.bind(null, job.id);
  const unassignCrewWithId = (userId: string) => unassignCrewMember.bind(null, job.id, userId);
  const createSignatureRequestWithId = createSignatureRequest.bind(null, job.id);
  const createInvoiceWithId = createInvoice.bind(null, job.id);

  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;
  const pendingSignature = job.signatureRequests.find((r) => r.status === "PENDING");
  const signedSignature = job.signatureRequests.find((r) => r.status === "SIGNED");

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Contract-style summary — the same JobLineItem rows used as the
          estimate are rendered here as contract content, via the shared
          ContractSummary component also used by the public /esign/[token]
          signing page. Nothing below this heading is retyped anywhere. */}
      <div className="mb-10">
        <ContractSummary
          companyName={company.name}
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
          footer={<PrintButton />}
        />
      </div>

      <div className="print:hidden">
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Schedule</h2>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <form action={updateScheduleWithId} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Start date
                <input
                  type="date"
                  name="startDate"
                  defaultValue={dateInputValue(job.startDate)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                End date
                <input
                  type="date"
                  name="endDate"
                  defaultValue={dateInputValue(job.endDate)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Save dates
              </button>
            </form>

            <div className="mt-4 border-t border-slate-800 pt-4">
              <p className="mb-2 text-sm font-medium text-slate-300">Crew</p>
              {job.assignments.length === 0 ? (
                <p className="text-sm text-slate-500">No one assigned yet.</p>
              ) : (
                <ul className="mb-3 flex flex-col gap-1">
                  {job.assignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-100">
                        {assignment.user.name ?? assignment.user.email}
                      </span>
                      <form action={unassignCrewWithId(assignment.userId)}>
                        <button type="submit" className="text-xs text-red-400 hover:underline">
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {unassignedMembers.length > 0 && (
                <form action={assignCrewWithId} className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Assign teammate
                    <select
                      name="userId"
                      required
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      {unassignedMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name ?? member.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                  >
                    Assign
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Contract signature</h2>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            {signedSignature ? (
              <p className="text-sm text-green-400">
                Signed by {signedSignature.signerName} on{" "}
                {signedSignature.signedAt?.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                .
              </p>
            ) : pendingSignature ? (
              <div className="text-sm">
                <p className="mb-2 text-slate-300">
                  Waiting on the client to sign. Share this link with them:
                </p>
                <p className="break-all rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-blue-400">
                  {origin}/esign/{pendingSignature.token}
                </p>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-sm text-slate-400">
                  No signing link yet. Once the client signs, this job can be marked as contracted.
                </p>
                <form action={createSignatureRequestWithId}>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                  >
                    Create signing link
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Job costing &amp; WIP</h2>

          <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Contract value</p>
              <p className="text-slate-100">{money(jobWip.contractValue)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Actual cost to date</p>
              <p className="text-slate-100">{money(jobWip.actualCostToDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">% complete</p>
              <p className="text-slate-100">
                {jobWip.percentComplete != null ? `${(jobWip.percentComplete * 100).toFixed(1)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Earned revenue</p>
              <p className="text-slate-100">{money(jobWip.earnedRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Billed to date</p>
              <p className="text-slate-100">{money(jobWip.billedToDate)}</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs text-slate-500">Over / under billed</p>
              <p className={jobWip.overUnderBilling > 0 ? "text-amber-400" : "text-green-400"}>
                {jobWip.overUnderBilling > 0
                  ? `Overbilled ${money(jobWip.overUnderBilling)}`
                  : jobWip.overUnderBilling < 0
                    ? `Underbilled ${money(Math.abs(jobWip.overUnderBilling))}`
                    : "Even"}
              </p>
            </div>
          </div>

          <WipNarrativeButton jobId={job.id} />

          <div className="mt-6 flex flex-col gap-4">
            {lineItemWip.map(({ item, wip }) => {
              const tradeLabel = TRADE_SCOPE_OPTIONS.find((t) => t.value === item.tradeScope)?.label;
              return (
                <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-slate-100">
                      {item.description}
                      {tradeLabel && (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                          {tradeLabel}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-400">Contract {money(wip.contractValue)}</span>
                    <span className="text-slate-400">
                      Budget {wip.budgetedCost != null ? money(wip.budgetedCost) : "—"}
                    </span>
                    <span className="text-slate-400">
                      Current est. {wip.currentEstimatedCost != null ? money(wip.currentEstimatedCost) : "—"}
                    </span>
                    <span className="text-slate-400">Actual {money(wip.actualCostToDate)}</span>
                    <span className="text-slate-400">
                      % complete {wip.percentComplete != null ? `${(wip.percentComplete * 100).toFixed(1)}%` : "—"}
                    </span>
                    <span className="text-slate-400">
                      Earned {wip.earnedRevenue != null ? money(wip.earnedRevenue) : "—"}
                    </span>
                  </div>

                  {item.costEntries.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3">
                      {item.costEntries.map((entry) => (
                        <li key={entry.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">
                            {entry.description}{" "}
                            <span className="text-xs text-slate-500">({entry.category})</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-slate-100">{money(Number(entry.amount))}</span>
                            <form action={deleteCostEntryWithId(entry.id)}>
                              <button
                                type="submit"
                                title="Remove"
                                className="text-xs text-red-400 hover:underline"
                              >
                                Remove
                              </button>
                            </form>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    action={addCostEntryWithId(item.id)}
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
                  >
                    <input
                      name="description"
                      placeholder="Cost description"
                      required
                      className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      name="amount"
                      placeholder="Amount"
                      required
                      className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <select
                      name="category"
                      defaultValue="OTHER"
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      {COST_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      name="tradeScope"
                      defaultValue={item.tradeScope ?? ""}
                      title="Trade this expense belongs to — defaults to this line item's trade, but can differ (e.g. a general-conditions line spanning several trades)"
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">No trade tag</option>
                      {TRADE_SCOPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Log cost
                    </button>
                  </form>

                  <form
                    action={updateLineItemForecastWithId(item.id)}
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      Re-forecast current unit cost
                      <input
                        name="currentEstimatedUnitCost"
                        defaultValue={item.currentEstimatedUnitCost?.toString() ?? ""}
                        placeholder="per unit"
                        className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      Override cost-to-complete
                      <input
                        name="estimatedCostToComplete"
                        defaultValue={item.estimatedCostToComplete?.toString() ?? ""}
                        placeholder="leave blank to auto-derive"
                        title="Overrides the mechanical (current estimate - actual) calculation — use when you know something the cost data doesn't reflect yet"
                        className="w-44 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Save forecast
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>

        {!isEstimateStage && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-slate-100">Invoices</h2>
            <div className="flex flex-col gap-4">
              {job.invoices.map((invoice) => {
                const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
                const balance = Number(invoice.amount) - paid;
                const logPaymentWithIds = logPayment.bind(null, job.id, invoice.id);
                return (
                  <div key={invoice.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-slate-100">
                        Invoice #{invoice.number}
                        {invoice.description ? ` — ${invoice.description}` : ""}
                      </p>
                      <div className="flex gap-4 text-sm">
                        <span className="text-slate-400">Amount {money(Number(invoice.amount))}</span>
                        <span className="text-slate-400">Paid {money(paid)}</span>
                        <span className={balance <= 0 ? "text-green-400" : "text-amber-400"}>
                          {balance <= 0 ? "Paid in full" : `Balance ${money(balance)}`}
                        </span>
                      </div>
                    </div>
                    {invoice.dueAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        Due {invoice.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}

                    {invoice.payments.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3">
                        {invoice.payments.map((payment) => (
                          <li key={payment.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-300">
                              {payment.receivedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              {payment.method ? ` · ${payment.method}` : ""}
                              {payment.note ? ` · ${payment.note}` : ""}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-slate-100">{money(Number(payment.amount))}</span>
                              <form action={deletePayment.bind(null, job.id, payment.id)}>
                                <button
                                  type="submit"
                                  title="Remove"
                                  className="text-xs text-red-400 hover:underline"
                                >
                                  Remove
                                </button>
                              </form>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {balance > 0 && (
                      <form
                        action={logPaymentWithIds}
                        className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
                      >
                        <input
                          name="amount"
                          placeholder="Amount"
                          required
                          className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <input
                          name="method"
                          placeholder="Method (check, cash...)"
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <input
                          name="note"
                          placeholder="Note (optional)"
                          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                        >
                          Log payment
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>

            <form
              action={createInvoiceWithId}
              className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
            >
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Description
                <input
                  name="description"
                  placeholder="Deposit, final payment, etc."
                  className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Amount
                <input
                  name="amount"
                  required
                  className="w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Due date
                <input
                  type="date"
                  name="dueAt"
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Create invoice
              </button>
            </form>
          </section>
        )}

        {isEstimateStage ? (
          <>
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">Line items (estimate)</h2>
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                {job.lineItems.length === 0 && (
                  <p className="py-2 text-sm text-slate-400">No line items yet — add one below.</p>
                )}
                {job.lineItems.map((item) => (
                  <form
                    key={item.id}
                    action={updateLineItemWithId(item.id)}
                    className="flex flex-col gap-2 border-t border-slate-800 py-3 first:border-t-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        name="description"
                        defaultValue={item.description}
                        required
                        placeholder="Description"
                        className="min-w-[160px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <input
                        name="quantity"
                        defaultValue={item.quantity.toString()}
                        required
                        title="Quantity"
                        className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <input
                        name="unit"
                        defaultValue={item.unit ?? ""}
                        placeholder="Unit"
                        className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <select
                        name="tradeScope"
                        defaultValue={item.tradeScope ?? ""}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">No trade tag</option>
                        {TRADE_SCOPE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        Unit price
                        <input
                          name="unitPrice"
                          defaultValue={item.unitPrice?.toString() ?? ""}
                          placeholder="cost-only"
                          title="Leave blank for a cost-only budget line (general conditions, overhead) with no client-facing price"
                          className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        Budgeted cost
                        <input
                          name="budgetedUnitCost"
                          defaultValue={item.budgetedUnitCost?.toString() ?? ""}
                          placeholder="per unit"
                          title="Estimated unit cost at estimate approval — the frozen historical baseline for WIP reporting"
                          className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </label>
                      <button
                        type="submit"
                        title="Save"
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700"
                      >
                        Save
                      </button>
                      <button
                        type="submit"
                        formAction={deleteLineItemWithId(item.id)}
                        title="Remove"
                        className="rounded-md bg-red-950 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-900"
                      >
                        Remove
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            </section>

            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">Add line item</h2>
              <form action={addLineItemWithId} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Description
                  <input
                    name="description"
                    required
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Qty
                  <input
                    name="quantity"
                    defaultValue="1"
                    required
                    className="w-20 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Unit
                  <input
                    name="unit"
                    className="w-24 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Unit price
                  <input
                    name="unitPrice"
                    placeholder="cost-only"
                    title="Leave blank for a cost-only budget line (general conditions, overhead) with no client-facing price"
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Budgeted cost
                  <input
                    name="budgetedUnitCost"
                    placeholder="per unit"
                    title="Estimated unit cost — the historical baseline for WIP reporting"
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Trade
                  <select
                    name="tradeScope"
                    defaultValue=""
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">No trade tag</option>
                    {TRADE_SCOPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                >
                  Add line item
                </button>
              </form>
            </section>

            <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-2 text-lg font-semibold text-slate-100">Ready to lock this in?</h2>
              <p className="mb-3 text-sm text-slate-400">
                Once contracted, line items can only change through a change order — this keeps an
                audit trail of anything that changes after the client agrees to it.
              </p>
              {signedSignature ? (
                <form action={markContractedWithId}>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                  >
                    Mark as contracted
                  </button>
                </form>
              ) : (
                <p className="text-sm text-amber-400">
                  Get the client&apos;s signature above before contracting this job.
                </p>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">Add change order (new scope)</h2>
              <form action={addChangeOrderWithId} className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Change order title
                    <input
                      name="title"
                      required
                      className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                      placeholder="Add tile backsplash"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Notes
                    <input
                      name="description"
                      className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    New line item description
                    <input
                      name="itemDescription"
                      required
                      className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Qty
                    <input
                      name="quantity"
                      defaultValue="1"
                      required
                      className="w-20 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Unit
                    <input
                      name="unit"
                      className="w-24 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Unit price
                    <input
                      name="unitPrice"
                      placeholder="cost-only"
                      title="Leave blank for a cost-only budget line with no client-facing price"
                      className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Budgeted cost
                    <input
                      name="budgetedUnitCost"
                      placeholder="per unit"
                      className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Trade
                    <select
                      name="tradeScope"
                      defaultValue=""
                      className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">No trade tag</option>
                      {TRADE_SCOPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
                  >
                    Submit change order
                  </button>
                </div>
              </form>
            </section>

            {job.lineItems.length > 0 && (
              <section className="mb-10">
                <h2 className="mb-3 text-lg font-semibold text-slate-100">
                  Revise a line item via change order
                </h2>
                <form action={editViaChangeOrderWithId} className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      Change order title
                      <input
                        name="title"
                        required
                        className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                        placeholder="Upgrade countertop material"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      Notes
                      <input
                        name="description"
                        className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      Line item
                      <select
                        name="lineItemId"
                        required
                        className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        {job.lineItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.description} ({money(Number(item.quantity) * Number(item.unitPrice))})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      New qty
                      <input
                        name="quantity"
                        required
                        className="w-20 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      New unit price
                      <input
                        name="unitPrice"
                        placeholder="cost-only"
                        title="Leave blank to make this a cost-only budget line with no client-facing price"
                        className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
                    >
                      Submit revision
                    </button>
                  </div>
                </form>
              </section>
            )}

            {job.lineItems.length > 0 && (
              <section className="mb-10">
                <h2 className="mb-3 text-lg font-semibold text-slate-100">
                  Remove a line item via change order
                </h2>
                <form action={removeViaChangeOrderWithId} className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      Change order title
                      <input
                        name="title"
                        required
                        className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                        placeholder="Remove backsplash tile"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      Notes
                      <input
                        name="description"
                        className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-sm text-slate-300">
                      Line item
                      <select
                        name="lineItemId"
                        required
                        className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        {job.lineItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.description} ({money(Number(item.quantity) * Number(item.unitPrice))})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                    >
                      Submit removal
                    </button>
                  </div>
                </form>
              </section>
            )}
          </>
        )}

        {job.changeOrders.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-100">Change order history</h2>
            <ul className="flex flex-col gap-2">
              {job.changeOrders.map((co) => (
                <li key={co.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
                  <p className="font-medium text-slate-100">
                    CO #{co.number}: {co.title}
                  </p>
                  {co.description && <p className="text-slate-400">{co.description}</p>}
                  {co.edits.map((edit) => (
                    <p key={edit.id} className="text-slate-500">
                      {edit.field}: {edit.oldValue} → {edit.newValue}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
