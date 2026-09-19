"use client";

import { useState, useTransition } from "react";
import { confirmJobberImport, previewJobberImport } from "@/lib/actions";
import type { JobberJobClient, JobberPlan, LeftOut } from "@/lib/jobber-import";
import { MAX_IMPORT_ROWS } from "@/lib/jobber-import";
import { ExistingList, Problems } from "@/components/SpreadsheetImport";

/**
 * "Import from Jobber" → preview → Confirm, on the Jobber card.
 *
 * Same arrangement as SpreadsheetImport, with Jobber standing in for the
 * pasted file: the preview is for DISPLAY, and Confirm sends nothing — no
 * rows, no ids. The server pulls from Jobber again and plans again against
 * a fresh read, so what lands can never be something this component held.
 * The plan in state is the answer to "what did the preview say", and after
 * a confirm it is thrown away rather than shown as if it were still true.
 */

const chip = "rounded-full border px-2 py-0.5";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

type Result = { ok: true; message: string } | { ok: false; message: string };

function clientNote(client: JobberJobClient): string {
  return client.kind === "existing" ? "your client" : "new client — added";
}

/** Also used by the QuickBooks import (QuickBooksImport.tsx). */
export function Counts({
  created,
  existing,
  problems,
  leftOut,
}: {
  created: number;
  existing: number;
  problems: number;
  leftOut: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className={`${chip} border-line-card bg-tag-green text-tag-green-ink`}>{created} will be added</span>
      <span className={`${chip} border-line-card bg-canvas text-ink-label`}>{existing} already in C Stream</span>
      <span className={`${chip} border-line-card bg-tag-amber text-tag-amber-ink`}>{problems} with problems — skipped</span>
      {leftOut > 0 && <span className={`${chip} border-line-card bg-canvas text-ink-label`}>{leftOut} left out on purpose</span>}
    </div>
  );
}

/** Also used by the QuickBooks import (QuickBooksImport.tsx). */
export function LeftOutList({ items }: { items: LeftOut[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-3 rounded-md border border-line-row px-3 py-2 text-xs text-ink-body">
      <summary className="cursor-pointer text-ink-label">{items.length} left out on purpose</summary>
      <ul className="mt-2 flex flex-col gap-0.5">
        {items.slice(0, 50).map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.label} — {item.reason}
          </li>
        ))}
        {items.length > 50 && <li className="text-ink-muted">…and {items.length - 50} more.</li>}
      </ul>
    </details>
  );
}

export function JobberImport() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<JobberPlan | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  function preview() {
    setOpen(true);
    setResult(null);
    startLoading(async () => {
      const outcome = await previewJobberImport();
      if (outcome.ok) setPlan(outcome.value);
      else {
        setPlan(null);
        setResult({ ok: false, message: outcome.error });
      }
    });
  }

  function confirm() {
    startSaving(async () => {
      const outcome = await confirmJobberImport();
      if (outcome.ok) {
        // What the preview said is no longer true. Pressing Import again
        // reads Jobber afresh and shows everything as already here.
        setPlan(null);
        setResult({ ok: true, message: outcome.value.message });
      } else {
        setResult({ ok: false, message: outcome.error });
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-4 border-t border-line-card pt-4">
        <button
          type="button"
          data-tour="jobber-import"
          onClick={preview}
          className="min-h-11 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
        >
          Import from Jobber
        </button>
        <p className="mt-2 text-xs text-ink-muted">
          Shows you what would come across first. Nothing is saved until you press Confirm.
        </p>
      </div>
    );
  }

  const clientsNew = plan?.clients.create.length ?? 0;
  const jobsNew = plan?.jobs.create.length ?? 0;
  const total = clientsNew + jobsNew;

  return (
    <section className="mt-4 border-t border-line-card pt-4" aria-label="Import from Jobber">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-label">Import from Jobber</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={preview}
            disabled={loading || saving}
            className="min-h-11 px-2 text-xs text-ink-body hover:text-ink-label disabled:opacity-60"
          >
            Read Jobber again
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setPlan(null);
              setResult(null);
            }}
            className="min-h-11 px-2 text-xs text-ink-body hover:text-ink-label"
          >
            Close
          </button>
        </div>
      </div>

      {loading && (
        <p role="status" className="text-sm text-ink-body">
          Reading your Jobber account… a big account can take a minute.
        </p>
      )}

      {plan && !loading && (
        <div data-tour="jobber-preview">
          {plan.notices.map((notice) => (
            <p key={notice} role="note" className="mb-2 rounded-md border border-line-card bg-tag-amber px-3 py-2 text-xs text-tag-amber-ink">
              {notice}
            </p>
          ))}

          <h4 className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Clients</h4>
          <div className="mt-1">
            <Counts
              created={clientsNew}
              existing={plan.clients.existing.length}
              problems={plan.clients.problems.length}
              leftOut={plan.clients.leftOut.length}
            />
          </div>
          <Problems problems={plan.clients.problems} showLine={false} />
          {clientsNew > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Email</th>
                    <th className={th}>Phone</th>
                    <th className={th}>Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-row">
                  {plan.clients.create.slice(0, 25).map((row) => (
                    <tr key={row.jobberId} className="text-ink-label">
                      <td className={td}>
                        {row.name}
                        {row.notes.map((note) => (
                          <span key={note} className="block text-tag-amber-ink">
                            {note}
                          </span>
                        ))}
                      </td>
                      <td className={`${td} text-ink-body`}>{row.email ?? "—"}</td>
                      <td className={`${td} text-ink-body`}>{row.phone ?? "—"}</td>
                      <td className={`${td} text-ink-body`}>
                        {row.address ?? "—"}
                        {row.addressFrom === "property" && <span className="block text-ink-muted">from their property</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {clientsNew > 25 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 25 of {clientsNew}. All of them will be added.
                </p>
              )}
            </div>
          )}
          <ExistingList items={plan.clients.existing} noun="clients" showLine={false} />

          <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Jobs and open quotes</h4>
          <div className="mt-1">
            <Counts
              created={jobsNew}
              existing={plan.jobs.existing.length}
              problems={plan.jobs.problems.length}
              leftOut={plan.jobs.leftOut.length}
            />
          </div>
          {jobsNew > 0 && (
            <p role="note" className="mt-3 rounded-md border border-line-card bg-tag-amber px-3 py-2 text-xs text-tag-amber-ink">
              <span className="font-semibold">Every job and quote comes in as an estimate</span>, whatever
              Jobber calls it. To make one contracted, open it, add its line items and its signed contract,
              and mark it contracted there — the same as any other job. Jobber&apos;s prices are not brought
              over: a job&apos;s value in C Stream is the sum of its line items.
            </p>
          )}
          <Problems problems={plan.jobs.problems} showLine={false} />
          {jobsNew > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className={th}>In Jobber</th>
                    <th className={th}>Job</th>
                    <th className={th}>Client</th>
                    <th className={th}>Comes in as</th>
                    <th className={th}>Site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-row">
                  {plan.jobs.create.slice(0, 25).map((row) => (
                    <tr key={row.jobberId} className="text-ink-label">
                      <td className={`${td} text-ink-muted`}>
                        {row.reference}
                        {row.jobberStatus && <span className="block">{row.jobberStatus.replace(/_/g, " ")}</span>}
                      </td>
                      <td className={td}>
                        {row.name}
                        {row.notes.map((note) => (
                          <span key={note} className="block text-tag-amber-ink">
                            {note}
                          </span>
                        ))}
                      </td>
                      <td className={`${td} text-ink-body`}>
                        {row.client.name}
                        <span className="block text-ink-muted">{clientNote(row.client)}</span>
                      </td>
                      <td className={`${td} text-ink-body`}>Estimate</td>
                      <td className={`${td} text-ink-body`}>{row.site ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {jobsNew > 25 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 25 of {jobsNew}. All of them will be added.
                </p>
              )}
            </div>
          )}
          <ExistingList items={plan.jobs.existing} noun="jobs" showLine={false} />
          <LeftOutList items={plan.jobs.leftOut} />

          <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Properties</h4>
          <p className="mt-1 text-xs text-ink-body" data-tour="jobber-properties">
            {plan.properties.total} {plan.properties.total === 1 ? "property" : "properties"} in Jobber.{" "}
            {plan.properties.asSite} become the site address on the jobs above, and{" "}
            {plan.properties.asClientAddress} fill in a client&apos;s address where Jobber had no billing
            address. C Stream keeps an address on each job and client rather than a separate property list,
            so a property with no job and no need for it is not brought over.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-tour="jobber-confirm"
              onClick={confirm}
              disabled={saving || loading || total === 0}
              aria-busy={saving || undefined}
              className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Saving…"
                : total === 0
                  ? "Nothing new to add"
                  : `Confirm — add ${clientsNew} ${clientsNew === 1 ? "client" : "clients"} and ${jobsNew} ${jobsNew === 1 ? "job" : "jobs"}`}
            </button>
            <span className="text-xs text-ink-muted">
              Nothing already in C Stream is changed. Up to {MAX_IMPORT_ROWS} new clients and {MAX_IMPORT_ROWS} new
              jobs at a time.
            </span>
          </div>
        </div>
      )}

      {result && (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            result.ok ? "border-line-card bg-tag-green text-tag-green-ink" : "border-line-card bg-tag-rose text-tag-rose-ink"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
