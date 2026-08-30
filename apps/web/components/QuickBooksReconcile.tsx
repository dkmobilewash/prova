"use client";

import { useState, useTransition } from "react";
import { reconcileQuickBooksInvoices } from "@/lib/actions";
import { money } from "@/lib/money";

/**
 * "Is anything out of step with QuickBooks right now?"
 *
 * Fetched on demand rather than on page load. It is a round trip to Intuit
 * for every linked invoice, and most visits to Settings are not about
 * QuickBooks — a page that quietly calls an external API every time it
 * renders is a page that gets slow and rate-limited for no one's benefit.
 *
 * Read-only by design. The rows say what differs and stop there: deciding
 * which side is right belongs to a person, because a machine choosing
 * between two humans' numbers is precisely the behaviour that makes
 * contractors distrust an accounting integration.
 */

type Row = {
  invoiceId: string;
  number: number;
  jobName: string;
  status: string;
  ourTotalCents: number;
  theirTotalCents: number | null;
  qboId: string | null;
  differences: string[];
};

const TONE: Record<string, string> = {
  DIFFERS: "border-rose-800 bg-rose-950/40 text-rose-200",
  MISSING_IN_QUICKBOOKS: "border-amber-800 bg-amber-950/40 text-amber-200",
  NEVER_SENT: "border-slate-700 bg-slate-900 text-slate-300",
  MATCHES: "border-emerald-900 bg-emerald-950/30 text-emerald-200",
};

const LABEL: Record<string, string> = {
  DIFFERS: "Disagrees with QuickBooks",
  MISSING_IN_QUICKBOOKS: "QuickBooks no longer has this",
  NEVER_SENT: "Never sent to QuickBooks",
  MATCHES: "Agrees",
};

export function QuickBooksReconcile() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAgreeing, setShowAgreeing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function check() {
    setError(null);
    startTransition(async () => {
      const result = await reconcileQuickBooksInvoices();
      if (result.ok) {
        setRows(result.rows as Row[]);
        setCheckedAt(new Date().toISOString().slice(11, 16));
      } else {
        setError(result.error);
      }
    });
  }

  const problems = rows?.filter((r) => r.status === "DIFFERS" || r.status === "MISSING_IN_QUICKBOOKS") ?? [];
  const quiet = rows?.filter((r) => r.status === "NEVER_SENT" || r.status === "MATCHES") ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={check}
          disabled={isPending}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Checking QuickBooks…" : rows ? "Check again" : "Check against QuickBooks"}
        </button>
        {checkedAt && !isPending && (
          <span className="text-xs text-slate-500">Checked at {checkedAt} UTC</span>
        )}
        {error && <p className="text-xs text-rose-300">{error}</p>}
      </div>

      {rows && problems.length === 0 && (
        <p className="text-sm text-emerald-300">
          Every invoice sent to QuickBooks still matches what Prova holds.
          {quiet.some((r) => r.status === "NEVER_SENT") &&
            " Some invoices have never been sent — those are listed below."}
        </p>
      )}

      {problems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {problems.map((row) => (
            <li key={row.invoiceId} className={`rounded-md border px-3 py-2 ${TONE[row.status]}`}>
              <p className="text-xs font-medium">{LABEL[row.status]}</p>
              <p className="mt-0.5 text-sm">
                Invoice {row.number} on {row.jobName}
                {row.qboId && <span className="opacity-80"> · QuickBooks invoice {row.qboId}</span>}
              </p>
              {row.differences.map((difference) => (
                <p key={difference} className="mt-0.5 text-xs opacity-90">
                  {difference}
                </p>
              ))}
              {row.status === "MISSING_IN_QUICKBOOKS" && (
                <p className="mt-0.5 text-xs opacity-90">
                  Prova has {money(row.ourTotalCents / 100)} and a link to QuickBooks invoice{" "}
                  {row.qboId}, but QuickBooks has nothing there — it was deleted in QuickBooks.
                </p>
              )}
              {/* No "fix this" button, deliberately. Which side is right is
                  a judgement about someone's books, and guessing it is how
                  an integration loses a bookkeeper's trust for good. */}
              <p className="mt-1 text-xs opacity-70">
                Open it in QuickBooks and decide which version is right. Re-sending from Prova
                overwrites QuickBooks with Prova&apos;s numbers.
              </p>
            </li>
          ))}
        </ul>
      )}

      {rows && quiet.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAgreeing((open) => !open)}
            className="text-xs text-slate-400 underline hover:text-slate-200"
          >
            {showAgreeing ? "Hide" : "Show"} the other {quiet.length}{" "}
            {quiet.length === 1 ? "invoice" : "invoices"}
          </button>
          {showAgreeing && (
            <ul className="mt-2 flex flex-col gap-1">
              {quiet.map((row) => (
                <li
                  key={row.invoiceId}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-400"
                >
                  <span>
                    Invoice {row.number} — {row.jobName}
                  </span>
                  <span>{LABEL[row.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
