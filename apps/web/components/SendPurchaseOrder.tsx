"use client";

import { useState, useTransition } from "react";
import { sendDraftPurchaseOrder } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { Spinner } from "@/components/Spinner";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";
import type { DocumentEmailDraft } from "@/lib/document-email";
import type { PurchaseOrderDocument } from "@/lib/purchase-order-pdf";

const inputClass = "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none";
const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50";
const labelClass = "flex flex-col gap-1 text-xs text-ink-muted";

/** The PDF the supplier gets: issued, on the day it is sent, never "DRAFT - NOT ISSUED". */
export function asSent(doc: PurchaseOrderDocument, sentOn: string): PurchaseOrderDocument {
  return { ...doc, status: "ISSUED", issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(sentOn) ? formatCalendarDate(new Date(`${sentOn}T00:00:00.000Z`)) : null };
}

/**
 * "Send PO to supplier" on a DRAFT purchase order. The first press only opens a PREVIEW, which
 * does nothing on the server: who it goes to (the supplier's email from their imported price
 * list, changeable), the subject and message, the lines and total, and the PDF itself. Only the
 * second press, "Send PO to supplier" inside the preview, emails it and issues the PO
 * (`sendDraftPurchaseOrder`). Opened by a click, so today's date is safe to read here.
 */
export function SendPurchaseOrder({ id, document: doc, email }: { id: string; document: PurchaseOrderDocument; email: DocumentEmailDraft }) {
  const [open, setOpen] = useState(false);
  const [sentOn, setSentOn] = useState("");
  const [toAddress, setTo] = useState(email.toAddress);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const total = doc.lines.reduce((n, l) => n + Number((l.quantity * l.unitPrice).toFixed(2)), 0);

  if (sent !== null) {
    return (
      <p role="status" className="text-sm text-ink" data-po-send="sent">
        PO {doc.number} sent to {sent} and issued. It is logged on the job; see it on Buyout.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className={btn}
        data-po-send="open"
        onClick={() => {
          setSentOn(localToday());
          setOpen(true);
        }}
      >
        Send PO to supplier
      </button>
    );
  }

  async function openPdf() {
    setError(null);
    try {
      const { buildPurchaseOrderPdf } = await import("@/lib/purchase-order-pdf");
      const bytes = await buildPurchaseOrderPdf(asSent(doc, sentOn));
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), "_blank", "noopener");
    } catch {
      setError("That PDF could not be built.");
    }
  }

  return (
    <form
      className="flex w-full max-w-xl flex-col gap-2 rounded-md border border-line-card p-3"
      data-po-send="preview"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result = await sendDraftPurchaseOrder(id, form);
            if (result.ok) setSent(toAddress);
            else setError(result.error);
          } catch {
            setError("That may not have gone. Reload the page and check Buyout before sending again.");
          }
        });
      }}
    >
      <p className="text-sm font-medium text-ink">Preview: nothing has been sent yet.</p>
      <p className="text-xs text-ink-body" data-po-send="summary">
        PO {doc.number} to {doc.vendor.name}: {doc.lines.length} line{doc.lines.length === 1 ? "" : "s"}, {money(total)}. Sending issues it on the date below.
      </p>
      <input type="hidden" name="toName" value={email.toName} />
      <label className={labelClass}>
        To
        <input name="toAddress" type="email" required value={toAddress} onChange={(e) => setTo(e.target.value)} className={inputClass} data-po-send="to" />
      </label>
      {email.toAddress === "" && (
        <p className="text-xs text-ink-muted" data-po-send="no-contact">
          {doc.vendor.name}&apos;s price list gave no email. Type the address their orders go to.
        </p>
      )}
      <label className={labelClass}>
        Subject
        <input name="subject" required defaultValue={email.subject} className={inputClass} />
      </label>
      <label className={labelClass}>
        Message
        <textarea name="body" required rows={5} defaultValue={email.body} className={inputClass} />
      </label>
      <label className={labelClass}>
        Date sent, and issued
        <input name="sentOn" type="date" required value={sentOn} onChange={(e) => setSentOn(e.target.value)} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => void openPdf()} data-po-send="pdf">
          Open the PDF
        </button>
        <button type="submit" disabled={isPending || toAddress.trim() === ""} className={primary} data-po-send="send">
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Sending…
            </span>
          ) : (
            "Send PO to supplier"
          )}
        </button>
        <button type="button" disabled={isPending} className={btn} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
