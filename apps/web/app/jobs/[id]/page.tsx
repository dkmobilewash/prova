import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { addChangeOrderLineItem, addLineItem, editLineItemViaChangeOrder } from "@/lib/actions";

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
        include: { originChangeOrder: true },
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

  const total = job.lineItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0,
  );

  const addLineItemWithId = addLineItem.bind(null, job.id);
  const addChangeOrderWithId = addChangeOrderLineItem.bind(null, job.id);
  const editViaChangeOrderWithId = editLineItemViaChangeOrder.bind(null, job.id);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* Contract-style summary — the same JobLineItem rows used as the
          estimate are rendered here as contract content. Nothing below this
          heading is retyped from a separate table. */}
      <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-semibold">{job.name}</h1>
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
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Add line item (estimate)</h2>
        <form action={addLineItemWithId} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Description
            <input
              name="description"
              required
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Qty
            <input
              name="quantity"
              defaultValue="1"
              required
              className="w-20 rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Unit
            <input name="unit" className="w-24 rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Unit price
            <input
              name="unitPrice"
              required
              className="w-28 rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
          >
            Add line item
          </button>
        </form>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Add change order (new scope)</h2>
        <form action={addChangeOrderWithId} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Change order title
              <input
                name="title"
                required
                className="w-64 rounded-md border border-slate-300 px-3 py-2"
                placeholder="Add tile backsplash"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Notes
              <input name="description" className="w-64 rounded-md border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              New line item description
              <input
                name="itemDescription"
                required
                className="w-64 rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Qty
              <input
                name="quantity"
                defaultValue="1"
                required
                className="w-20 rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Unit
              <input name="unit" className="w-24 rounded-md border border-slate-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Unit price
              <input
                name="unitPrice"
                required
                className="w-28 rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Submit change order
            </button>
          </div>
        </form>
      </section>

      {job.lineItems.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">Revise a line item via change order</h2>
          <form action={editViaChangeOrderWithId} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Change order title
                <input
                  name="title"
                  required
                  className="w-64 rounded-md border border-slate-300 px-3 py-2"
                  placeholder="Upgrade countertop material"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Notes
                <input name="description" className="w-64 rounded-md border border-slate-300 px-3 py-2" />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Line item
                <select
                  name="lineItemId"
                  required
                  className="w-64 rounded-md border border-slate-300 px-3 py-2"
                >
                  {job.lineItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.description} ({money(Number(item.quantity) * Number(item.unitPrice))})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                New qty
                <input
                  name="quantity"
                  required
                  className="w-20 rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                New unit price
                <input
                  name="unitPrice"
                  required
                  className="w-28 rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Submit revision
              </button>
            </div>
          </form>
        </section>
      )}

      {job.changeOrders.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Change order history</h2>
          <ul className="flex flex-col gap-2">
            {job.changeOrders.map((co) => (
              <li key={co.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <p className="font-medium">
                  CO #{co.number}: {co.title}
                </p>
                {co.description && <p className="text-slate-600">{co.description}</p>}
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
    </main>
  );
}
