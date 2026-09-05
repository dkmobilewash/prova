"use client";

import { useState, useTransition } from "react";
import {
  deleteComplianceDocument,
  markComplianceDocumentReceived,
  updateComplianceDocument,
} from "@/lib/actions";
import { money } from "@/lib/money";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

const TYPE_LABELS: Record<string, string> = {
  LIEN_WAIVER: "Lien waiver",
  CERTIFICATE_OF_INSURANCE: "Certificate of insurance",
  CERTIFIED_PAYROLL: "Certified payroll",
  UNION_FRINGE_BENEFIT_FILING: "Union fringe/benefit filing",
  UNION_AGREEMENT: "Union agreement",
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS);

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-slate-400";

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString() : "—";
}

function toDateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function expirationStatus(date: Date | null) {
  if (!date) return null;
  const daysUntil = Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return { text: "Expired", className: "text-red-400" };
  if (daysUntil <= 30) return { text: `Expires in ${daysUntil}d`, className: "text-amber-400" };
  return null;
}

export interface ComplianceDocumentRowData {
  id: string;
  type: string;
  partyName: string;
  status: string;
  amount: string | null; // Decimal serialized to string by the server component
  periodStart: Date | null;
  periodEnd: Date | null;
  effectiveDate: Date | null;
  expiresAt: Date | null;
  notes: string | null;
  fileUrl: string | null;
  fileName: string | null;
  aiExtracted: boolean;
  jobName: string | null;
}

/** A document's whole row, including its own edit-mode toggle — the fix
 * path for a bad AI extraction (aiExtracted just flags "please verify",
 * it isn't a lock) as well as for editing a manually-entered record. */
export function ComplianceDocumentRow({ doc, canDelete }: { doc: ComplianceDocumentRowData; canDelete: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateComplianceDocument(doc.id, formData);
        setIsEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Type
              <select name="type" defaultValue={doc.type} className={inputClass}>
                {TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Party name
              <input name="partyName" defaultValue={doc.partyName} required className={inputClass} />
            </label>
            <label className={labelClass}>
              Amount
              <input name="amount" type="number" step="0.01" defaultValue={doc.amount ?? ""} className={inputClass} />
            </label>
            <label className={labelClass}>
              Effective date
              <input
                name="effectiveDate"
                type="date"
                defaultValue={toDateInputValue(doc.effectiveDate)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Expires
              <input
                name="expiresAt"
                type="date"
                defaultValue={toDateInputValue(doc.expiresAt)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Period start
              <input
                name="periodStart"
                type="date"
                defaultValue={toDateInputValue(doc.periodStart)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Period end
              <input
                name="periodEnd"
                type="date"
                defaultValue={toDateInputValue(doc.periodEnd)}
                className={inputClass}
              />
            </label>
          </div>
          <label className={labelClass}>
            Notes
            <textarea name="notes" defaultValue={doc.notes ?? ""} rows={2} className={inputClass} />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </form>
      </li>
    );
  }

  const expiration = expirationStatus(doc.expiresAt);

  return (
    <li className="flex flex-col gap-2 p-4">
      {/* flex-wrap, and the text column may shrink: this row's action
          cluster was shrink-0 and unwrappable, so on a 360px screen it ran
          past the viewport and dragged the whole page sideways. Found by
          measuring, not by looking — scrollWidth 429 against a 360 client. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-100">{TYPE_LABELS[doc.type] ?? doc.type}</p>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                doc.status === "RECEIVED" ? "bg-green-500/15 text-green-300" : "bg-slate-800 text-slate-300"
              }`}
            >
              {doc.status === "RECEIVED" ? "Received" : "Pending"}
            </span>
            {doc.aiExtracted && (
              <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                AI-extracted — verify
              </span>
            )}
            {expiration && <span className={`text-xs font-medium ${expiration.className}`}>{expiration.text}</span>}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {doc.partyName}
            {doc.jobName && <> · {doc.jobName}</>}
            {doc.amount != null && <> · {money(Number(doc.amount))}</>}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {doc.periodStart || doc.periodEnd ? (
              <>
                Period {formatDate(doc.periodStart)} – {formatDate(doc.periodEnd)}
                {" · "}
              </>
            ) : null}
            Effective {formatDate(doc.effectiveDate)}
            {doc.expiresAt && <> · Expires {formatDate(doc.expiresAt)}</>}
          </p>
          {doc.notes && <p className="mt-1 text-xs text-slate-500">Note: {doc.notes}</p>}
          {doc.fileUrl && (
            <a
              href={doc.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-blue-400 hover:underline"
            >
              {doc.fileName ?? "View file"}
            </a>
          )}
        </div>
        {/* Two steps, like every other list. A compliance document is
            evidence — a signed waiver or a certificate someone sent you —
            and one stray click should not be able to destroy it.

            Arming it also empties this row: "Edit" and "Mark received" both
            used to stay live beside the armed confirm, which is issue #152's
            fourth instance and how somebody marks a document received while
            trying to cancel a delete. They are children of RowActions now,
            so the next button added here is covered without anyone
            remembering to cover it. */}
        <RowActions
          className="flex flex-wrap items-center gap-3"
          destructive={
            canDelete ? (
              <ConfirmDelete action={deleteComplianceDocument.bind(null, doc.id)} />
            ) : null
          }
        >
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Edit
          </button>
          {doc.status === "PENDING" && (
            <form action={markComplianceDocumentReceived.bind(null, doc.id)}>
              <button
                type="submit"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Mark received
              </button>
            </form>
          )}
        </RowActions>
      </div>
    </li>
  );
}
