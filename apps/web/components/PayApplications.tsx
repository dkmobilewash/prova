"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { submitPayApplication, updateInvoiceStatus } from "@/lib/actions";

const inputClass =
  "w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

const STATUS_OPTIONS = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
  { value: "DISPUTED", label: "Disputed" },
] as const;

export type PayAppLineItemOption = {
  id: string;
  description: string;
  scheduledValue: number;
};

export type PayAppInvoice = {
  id: string;
  number: number;
  status: string;
  amount: number;
  issuedAt: string;
};

export function StatusForm({ jobId, invoiceId, status }: { jobId: string; invoiceId: string; status: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onChange={(event) => {
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          await updateInvoiceStatus(jobId, invoiceId, formData);
        });
      }}
    >
      <select
        name="status"
        defaultValue={status}
        disabled={isPending}
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}

export function PayApplications({
  jobId,
  lineItems,
  payApplications,
}: {
  jobId: string;
  lineItems: PayAppLineItemOption[];
  payApplications: PayAppInvoice[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Pay applications</h2>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Submit pay application
          </button>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-500">
        A pay application bills against specific schedule-of-values lines — this period&rsquo;s completed work plus
        any materials stored, per line — rather than a single lump-sum amount. New materials stored carries forward
        automatically on later applications; leave it blank if nothing new was stored this period. See the full
        G702/G703-style report for each one below.
      </p>

      {isOpen && (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              try {
                await submitPayApplication(jobId, formData);
                formRef.current?.reset();
                setIsOpen(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not submit the pay application");
              }
            });
          }}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
        >
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Description
              <input
                name="description"
                placeholder="Application for payment #3"
                className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
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
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="pb-1 pr-3 font-normal">Line item</th>
                  <th className="pb-1 pr-3 text-right font-normal">Scheduled value</th>
                  <th className="pb-1 pr-3 text-right font-normal">This period</th>
                  <th className="pb-1 text-right font-normal">New materials stored</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.id} className="border-t border-slate-800">
                    <td className="py-1 pr-3 text-slate-300">{item.description}</td>
                    <td className="py-1 pr-3 text-right text-slate-500">
                      {item.scheduledValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </td>
                    <td className="py-1 pr-3 text-right">
                      <input type="hidden" name="lineItemId" value={item.id} />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="thisPeriodBilled"
                        placeholder="0.00"
                        className={inputClass}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="materialsStoredValue"
                        placeholder="0.00"
                        className={inputClass}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Submitting…" : "Submit pay application"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {payApplications.length === 0 ? (
        <p className="text-sm text-slate-400">No pay applications submitted yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payApplications.map((app) => (
            <li
              key={app.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"
            >
              <div>
                <Link href={`/jobs/${jobId}/pay-applications/${app.id}`} className="text-blue-400 hover:underline">
                  Application #{app.number}
                </Link>
                <span className="ml-2 text-slate-500">
                  {new Date(app.issuedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}
                  {app.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                </span>
              </div>
              <StatusForm jobId={jobId} invoiceId={app.id} status={app.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
