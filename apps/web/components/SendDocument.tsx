"use client";

import { useState, useTransition } from "react";
import { sendPayApplication, sendPurchaseOrder } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { Spinner } from "@/components/Spinner";
import type { DocumentEmailDraft, SendRow } from "@/lib/document-email";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none";
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";
const labelClass = "flex flex-col gap-1 text-xs text-ink-muted";

type Target = { kind: "PURCHASE_ORDER"; id: string } | { kind: "PAY_APPLICATION"; jobId: string; id: string };

/** Each send of this document and whether it arrived, with the file that went. */
export function SendHistory({ sends }: { sends: SendRow[] }) {
  if (sends.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {sends.map((send) => (
        <li key={send.id} className={send.needsAction ? "text-danger" : "text-ink-body"}>
          Emailed {send.sentOn} to {send.toAddress} · {send.status}
          {send.detail ? ` · ${send.detail}` : ""}
          {send.linkUntil ? ` · sent as a link, works until ${send.linkUntil}` : ""} ·{" "}
          <a href={`/api/sent-documents/${send.id}`} className="text-link hover:underline">
            Download what was sent
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Email this document. Opened by a click, so today's date is safe to read here. */
export function SendDocument({ target, draft }: { target: Target; draft: DocumentEmailDraft }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        Email this
      </button>
    );
  }

  return (
    <form
      className="flex w-full max-w-xl flex-col gap-2 rounded-md border border-line-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result =
              target.kind === "PURCHASE_ORDER" ? await sendPurchaseOrder(target.id, form) : await sendPayApplication(target.jobId, target.id, form);
            if (result.ok) setOpen(false);
            else setError(result.error);
          } catch {
            setError("That may not have gone. Reload the page and check before sending again.");
          }
        });
      }}
    >
      <input type="hidden" name="toName" value={draft.toName} />
      <label className={labelClass}>
        To
        <input name="toAddress" type="email" required defaultValue={draft.toAddress} className={inputClass} />
      </label>
      <label className={labelClass}>
        Subject
        <input name="subject" required defaultValue={draft.subject} className={inputClass} />
      </label>
      <label className={labelClass}>
        Message
        <textarea name="body" required rows={6} defaultValue={draft.body} className={inputClass} />
      </label>
      <label className={labelClass}>
        Date sent
        <input name="sentOn" type="date" required defaultValue={localToday()} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={isPending} className={btn}>
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Sending…
            </span>
          ) : (
            "Send with the PDF attached"
          )}
        </button>
        <button type="button" disabled={isPending} className={btn} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
