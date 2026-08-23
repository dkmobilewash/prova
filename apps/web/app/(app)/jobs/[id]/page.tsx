import { notFound } from "next/navigation";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import {
  addChangeOrderLineItem,
  addCostEntry,
  addLineItem,
  deleteCostEntry,
  deleteLineItem,
  editLineItemViaChangeOrder,
  markJobContracted,
  removeLineItemViaChangeOrder,
  updateLineItem,
} from "@/lib/actions";

const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;

function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
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
    },
  });

  if (!job || job.companyId !== company.id) {
    notFound();
  }

  const isEstimateStage = job.status === "ESTIMATE";
  const total = job.lineItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0,
  );

  const actualTotal = job.lineItems.reduce(
    (sum, item) => sum + item.costEntries.reduce((s, entry) => s + Number(entry.amount), 0),
    0,
  );

  const addLineItemWithId = addLineItem.bind(null, job.id);
  const updateLineItemWithId = (lineItemId: string) => updateLineItem.bind(null, job.id, lineItemId);
  const deleteLineItemWithId = (lineItemId: string) => deleteLineItem.bind(null, job.id, lineItemId);
  const addChangeOrderWithId = addChangeOrderLineItem.bind(null, job.id);
  const editViaChangeOrderWithId = editLineItemViaChangeOrder.bind(null, job.id);
  const removeViaChangeOrderWithId = removeLineItemViaChangeOrder.bind(null, job.id);
  const markContractedWithId = markJobContracted.bind(null, job.id);
  const addCostEntryWithId = (lineItemId: string) => addCostEntry.bind(null, job.id, lineItemId);
  const deleteCostEntryWithId = (costEntryId: string) => deleteCostEntry.bind(null, job.id, costEntryId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Contract-style summary — the same JobLineItem rows used as the
          estimate are rendered here as contract content. Nothing below this
          heading is retyped from a separate table. Kept as a light "paper"
          surface deliberately: it's the one thing on this page meant to
          look like an actual document, not app chrome. */}
      <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6 text-slate-900 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">{company.name}</p>
            <h1 className="text-2xl font-semibold">{job.name}</h1>
          </div>
          <StatusBadge status={job.status} />
        </div>
        <p className="mt-1 text-slate-600">Client: {job.contact.name}</p>
        {job.scope && <p className="mt-3 text-sm text-slate-700">{job.scope}</p>}

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">Description</th>
              <th className="py-2">Qty</th>
              <th className="py-2">Unit</th>
              <th className="py-2">Unit price</th>
              <th className="py-2 text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {job.lineItems.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2">
                  {item.description}
                  {item.originChangeOrder && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      CO #{item.originChangeOrder.number}
                    </span>
                  )}
                </td>
                <td className="py-2">{item.quantity.toString()}</td>
                <td className="py-2">{item.unit ?? "—"}</td>
                <td className="py-2">{money(Number(item.unitPrice))}</td>
                <td className="py-2 text-right">
                  {money(Number(item.quantity) * Number(item.unitPrice))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-right text-lg font-semibold">Total: {money(total)}</p>

        <p className="mt-6 text-xs text-slate-400 print:mt-16">
          This reflects the current agreed scope and pricing for this job, including any approved
          change orders.
        </p>

        <div className="mt-4 print:hidden">
          <PrintButton />
        </div>
      </section>

      <div className="print:hidden">
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Job costing</h2>
          <div className="flex flex-col gap-4">
            {job.lineItems.map((item) => {
              const estimated = Number(item.quantity) * Number(item.unitPrice);
              const actual = item.costEntries.reduce((s, entry) => s + Number(entry.amount), 0);
              const variance = estimated - actual;
              return (
                <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-slate-100">{item.description}</p>
                    <div className="flex gap-4 text-sm">
                      <span className="text-slate-400">Est. {money(estimated)}</span>
                      <span className="text-slate-400">Actual {money(actual)}</span>
                      <span className={variance >= 0 ? "text-green-400" : "text-red-400"}>
                        {variance >= 0 ? "Under" : "Over"} by {money(Math.abs(variance))}
                      </span>
                    </div>
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
                    <button
                      type="submit"
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Log cost
                    </button>
                  </form>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end gap-6 text-sm">
            <span className="text-slate-400">Total estimated: {money(total)}</span>
            <span className="text-slate-400">Total actual: {money(actualTotal)}</span>
            <span className={total - actualTotal >= 0 ? "text-green-400" : "text-red-400"}>
              {total - actualTotal >= 0 ? "Under" : "Over"} by {money(Math.abs(total - actualTotal))}
            </span>
          </div>
        </section>

        {isEstimateStage ? (
          <>
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">Line items (estimate)</h2>
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="grid grid-cols-[1fr_70px_80px_100px_auto] items-center gap-2 pb-2 text-xs font-medium text-slate-400">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Unit</span>
                  <span>Unit price</span>
                  <span></span>
                </div>
                {job.lineItems.length === 0 && (
                  <p className="py-2 text-sm text-slate-400">No line items yet — add one below.</p>
                )}
                {job.lineItems.map((item) => (
                  <form
                    key={item.id}
                    action={updateLineItemWithId(item.id)}
                    className="grid grid-cols-[1fr_70px_80px_100px_auto] items-center gap-2 border-t border-slate-800 py-2"
                  >
                    <input
                      name="description"
                      defaultValue={item.description}
                      required
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      name="quantity"
                      defaultValue={item.quantity.toString()}
                      required
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      name="unit"
                      defaultValue={item.unit ?? ""}
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      name="unitPrice"
                      defaultValue={item.unitPrice.toString()}
                      required
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                    <div className="flex gap-1">
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
                    required
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
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
              <form action={markContractedWithId}>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Mark as contracted
                </button>
              </form>
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
                      required
                      className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
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
                        required
                        className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
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
