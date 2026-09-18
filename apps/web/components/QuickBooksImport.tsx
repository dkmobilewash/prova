"use client";

import { useState, useTransition, type ReactNode } from "react";
import { confirmQuickBooksImport, previewQuickBooksImport } from "@/lib/actions";
import type { Bucket, QuickBooksPlan } from "@/lib/quickbooks-import";
import { MAX_IMPORT_ROWS } from "@/lib/quickbooks-import";
import { Counts, LeftOutList } from "@/components/JobberImport";
import { ExistingList, Problems } from "@/components/SpreadsheetImport";
import { money } from "@/lib/money";

/**
 * "Import from QuickBooks" → preview → Confirm, in the QuickBooks section of
 * /settings.
 *
 * The Jobber import's component with QuickBooks as the source, and built from
 * the same pieces (Counts, LeftOutList, ExistingList, Problems). The preview
 * is for DISPLAY; Confirm sends nothing — no rows, no ids. The server reads
 * QuickBooks again and plans again against a fresh read, so what lands can
 * never be something this component held. Buttons with onClick rather than
 * `<form action>`: React 19 resets a form before its action runs.
 */

const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

type Result = { ok: true; message: string } | { ok: false; message: string };

function Section<R>({
  title,
  bucket,
  noun,
  head,
  row,
  keyOf,
}: {
  title: string;
  bucket: Bucket<R>;
  noun: string;
  head: string[];
  row: (item: R) => ReactNode;
  keyOf: (item: R) => string;
}) {
  const count = bucket.create.length;
  return (
    <>
      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted first:mt-2">{title}</h4>
      <div className="mt-1">
        <Counts
          created={count}
          existing={bucket.existing.length}
          problems={bucket.problems.length}
          leftOut={bucket.leftOut.length}
        />
      </div>
      <Problems problems={bucket.problems} showLine={false} />
      {count > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-ink-muted">
              <tr>
                {head.map((label) => (
                  <th key={label} className={th}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-row">
              {bucket.create.slice(0, 25).map((item) => (
                <tr key={keyOf(item)} className="text-ink-label">
                  {row(item)}
                </tr>
              ))}
            </tbody>
          </table>
          {count > 25 && (
            <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
              Showing the first 25 of {count}. All of them will be added.
            </p>
          )}
        </div>
      )}
      <ExistingList items={bucket.existing} noun={noun} showLine={false} />
      <LeftOutList items={bucket.leftOut} />
    </>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <>
      {notes.map((note) => (
        <span key={note} className="block text-tag-amber-ink">
          {note}
        </span>
      ))}
    </>
  );
}

export function QuickBooksImport() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<QuickBooksPlan | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  function preview() {
    setOpen(true);
    setResult(null);
    startLoading(async () => {
      const outcome = await previewQuickBooksImport();
      if (outcome.ok) setPlan(outcome.value);
      else {
        setPlan(null);
        setResult({ ok: false, message: outcome.error });
      }
    });
  }

  function confirm() {
    startSaving(async () => {
      const outcome = await confirmQuickBooksImport();
      if (outcome.ok) {
        // What the preview said is no longer true. Pressing Import again
        // reads QuickBooks afresh and shows everything as already here.
        setPlan(null);
        setResult({ ok: true, message: outcome.value.message });
      } else {
        setResult({ ok: false, message: outcome.error });
      }
    });
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          data-tour="qbo-import"
          onClick={preview}
          className="min-h-11 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
        >
          Import from QuickBooks
        </button>
        <p className="mt-2 text-xs text-ink-muted">
          Brings your customers, vendors and products and services in. Shows you what would come across
          first — nothing is saved until you press Confirm, and nothing in QuickBooks is changed.
        </p>
      </div>
    );
  }

  const clientsNew = plan?.clients.create.length ?? 0;
  const vendorsNew = plan?.vendors.create.length ?? 0;
  const catalogNew = plan?.catalog.create.length ?? 0;
  const total = clientsNew + vendorsNew + catalogNew;

  return (
    <section aria-label="Import from QuickBooks">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-label">Import from QuickBooks</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={preview}
            disabled={loading || saving}
            className="min-h-11 px-2 text-xs text-ink-body hover:text-ink-label disabled:opacity-60"
          >
            Read QuickBooks again
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
          Reading your QuickBooks company… a big one can take a minute.
        </p>
      )}

      {plan && !loading && (
        <div data-tour="qbo-import-preview">
          {plan.notices.map((notice) => (
            <p key={notice} role="note" className="mb-2 rounded-md border border-line-card bg-tag-amber px-3 py-2 text-xs text-tag-amber-ink">
              {notice}
            </p>
          ))}

          <Section
            title="Customers → clients"
            bucket={plan.clients}
            noun="clients"
            head={["Name", "Email", "Phone", "Address"]}
            keyOf={(row) => row.qboId}
            row={(row) => (
              <>
                <td className={td}>
                  {row.name}
                  <Notes notes={row.notes} />
                </td>
                <td className={`${td} text-ink-body`}>{row.email ?? "—"}</td>
                <td className={`${td} text-ink-body`}>{row.phone ?? "—"}</td>
                <td className={`${td} text-ink-body`}>{row.address ?? "—"}</td>
              </>
            )}
          />

          <Section
            title="Vendors"
            bucket={plan.vendors}
            noun="vendors"
            head={["Name", "Contact", "Email", "Phone"]}
            keyOf={(row) => row.qboId}
            row={(row) => (
              <>
                <td className={td}>
                  {row.name}
                  <Notes notes={row.flags} />
                </td>
                <td className={`${td} text-ink-body`}>{row.contactName ?? "—"}</td>
                <td className={`${td} text-ink-body`}>{row.email ?? "—"}</td>
                <td className={`${td} text-ink-body`}>{row.phone ?? "—"}</td>
              </>
            )}
          />

          <Section
            title="Products and services → catalog"
            bucket={plan.catalog}
            noun="catalog entries"
            head={["Catalog entry", "In QuickBooks", "Price", "Cost"]}
            keyOf={(row) => row.qboId}
            row={(row) => (
              <>
                <td className={td}>
                  {row.description}
                  <Notes notes={row.notes} />
                </td>
                <td className={`${td} text-ink-muted`}>{row.qboType ?? "—"}</td>
                <td className={`${td} text-ink-body`}>{row.unitPrice != null ? money(row.unitPrice) : "—"}</td>
                <td className={`${td} text-ink-body`}>{row.unitCost != null ? money(row.unitCost) : "—"}</td>
              </>
            )}
          />
          {catalogNew > 0 && (
            <p role="note" className="mt-3 rounded-md border border-line-card bg-canvas px-3 py-2 text-xs text-ink-body">
              Products and services become catalog entries — the list you price a job&apos;s line items from on
              the Catalog page. They are not added to any job. Units and labour hours are not in QuickBooks, so
              fill those in on the Catalog page if you use them.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-tour="qbo-import-confirm"
              onClick={confirm}
              disabled={saving || loading || total === 0}
              aria-busy={saving || undefined}
              className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : total === 0 ? "Nothing new to add" : `Confirm — add ${total} ${total === 1 ? "record" : "records"}`}
            </button>
            <span className="text-xs text-ink-muted">
              Nothing already in C Stream is changed, and nothing is written to QuickBooks. Up to{" "}
              {MAX_IMPORT_ROWS} new of each kind at a time.
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
