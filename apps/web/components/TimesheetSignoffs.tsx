"use client";

import { useState, useTransition } from "react";
import { approveTimesheetDay, reopenTimesheetDay } from "@/lib/actions";
import { SignatureImage } from "@/components/SignatureImage";

export type TimesheetSignoffRowData = {
  id: string;
  /** Formatted by the server: a calendar day, in UTC. */
  dateLabel: string;
  state: "SUBMITTED" | "APPROVED" | "REOPENED";
  signerName: string;
  /** "Sep 18, 2026, 4:12 PM by Diego" — the reader's zone, formatted on the server. */
  signedLabel: string;
  entryCount: number;
  totalHours: string;
  signaturePath: string;
  approvedLabel: string | null;
  reopenedLabel: string | null;
  reopenReason: string | null;
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

const STATE_LABEL: Record<TimesheetSignoffRowData["state"], string> = {
  SUBMITTED: "Signed — waiting for approval",
  APPROVED: "Approved",
  REOPENED: "Reopened",
};

const STATE_CLASS: Record<TimesheetSignoffRowData["state"], string> = {
  SUBMITTED: "bg-amber-500/10 text-amber-300",
  APPROVED: "bg-emerald-500/10 text-emerald-300",
  REOPENED: "bg-slate-800 text-slate-400",
};

/**
 * The days a foreman has signed on the phone, newest first: the signature,
 * what it covered, and — for whoever owns payroll — Approve and Reopen.
 *
 * A signed day's hours are locked (the rows above show "locked" and offer no
 * Edit or Remove). Reopening is how a mistake gets fixed: it keeps the old
 * signature on the record, with the reason, and the foreman signs again.
 */
export function TimesheetSignoffs({ rows, canApprove }: { rows: TimesheetSignoffRowData[]; canApprove: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No days signed yet. The foreman signs a day&rsquo;s hours on the phone, under Time → Sign the day.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <SignoffRow key={row.id} row={row} canApprove={canApprove} />
      ))}
    </ul>
  );
}

function SignoffRow({ row, canApprove }: { row: TimesheetSignoffRowData; canApprove: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        after?.();
      } catch {
        setError("That did not go through. Reload the page and check the day before trying again.");
      }
    });
  };

  const live = row.state !== "REOPENED";

  return (
    <li
      className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm ${
        live ? "" : "opacity-70"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <SignatureImage path={row.signaturePath} label={`Signature of ${row.signerName}`} />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-100">{row.dateLabel}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${STATE_CLASS[row.state]}`}>{STATE_LABEL[row.state]}</span>
          </div>
          <span className="text-xs text-slate-400">
            {row.signerName} signed {row.entryCount} {row.entryCount === 1 ? "entry" : "entries"}, {row.totalHours}h
          </span>
          <span className="text-xs text-ink-muted">{row.signedLabel}</span>
          {row.approvedLabel && <span className="text-xs text-ink-muted">Approved {row.approvedLabel}</span>}
          {row.reopenedLabel && (
            <span className="text-xs text-ink-muted">
              Reopened {row.reopenedLabel}
              {row.reopenReason ? ` — ${row.reopenReason}` : ""}
            </span>
          )}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </div>

      {live && canApprove && !reopening && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {row.state === "SUBMITTED" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => approveTimesheetDay(row.id))}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Approving…" : "Approve"}
            </button>
          )}
          <button type="button" disabled={isPending} onClick={() => setReopening(true)} className={btn}>
            Reopen
          </button>
        </div>
      )}

      {live && canApprove && reopening && (
        <form
          className="flex w-full flex-col gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData();
            formData.set("reason", reason);
            run(
              () => reopenTimesheetDay(row.id, formData),
              () => setReopening(false),
            );
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Why is it being reopened? This stays on the record.
            <input
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending || reason.trim() === ""}
              className="rounded-md border border-amber-500 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {isPending ? "Reopening…" : "Reopen the day"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setReopening(false);
                setError(null);
              }}
              className={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
