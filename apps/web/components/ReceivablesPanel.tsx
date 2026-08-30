"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SidePanel } from "@prova/ui";
import { money } from "@/lib/money";
import type { OverdueInvoice } from "@/lib/today-dashboard";

/**
 * Split into a provider, a list and a panel so the panel can be a real
 * SIBLING of the content column rather than a child of it.
 *
 * That is the whole reason this is a context and not one component: a
 * panel rendered inside the column it is supposed to push cannot push it.
 * The list sits in the middle of the page; the panel sits at the end of
 * the flex row; they need shared state without shared position.
 */
type ReceivablesContext = {
  rows: OverdueInvoice[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

const Context = createContext<ReceivablesContext | null>(null);

function useReceivables(): ReceivablesContext {
  const value = useContext(Context);
  if (!value) throw new Error("Receivables components must be inside <ReceivablesProvider>");
  return value;
}

export function ReceivablesProvider({
  rows,
  children,
}: {
  rows: OverdueInvoice[];
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ rows, openId, setOpenId }), [rows, openId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Accounts receivable, with a detail column that pushes rather than covers.
 *
 * Pushing matters here specifically: the reason to open an invoice from
 * this list is to compare it against the rest of the list — whether this
 * GC is late on one invoice or five. A panel that covered the list would
 * take away the thing you opened it to see.
 *
 * The actions are honest about what exists. "Send a reminder" and "log a
 * call" are not built — there is no email channel and no activity model —
 * so they are shown disabled with the reason, rather than as buttons that
 * look real and do nothing. "Open the job" is the one that works, and it
 * goes to the page where a payment can actually be recorded.
 */
/** The width the panel needs. Below this it is display:none, so a click
 * that tried to open it would do nothing at all — browser testing found
 * exactly that dead band between 768px, where the desktop layout returns,
 * and 1024px. Below it, the row goes to the job instead of nowhere. */
const PANEL_MIN_WIDTH = "(min-width: 1024px)";

export function ReceivablesList() {
  const { rows, openId, setOpenId } = useReceivables();
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-body">
        Nothing outstanding. Every invoice raised has been paid in full.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-line-row">
        {rows.slice(0, 8).map((row) => {
          const isOpen = row.id === openId;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  // Read at click time, not render time — no hydration
                  // mismatch, and it follows a window that was resized.
                  const canShowPanel =
                    typeof window === "undefined" ||
                    window.matchMedia(PANEL_MIN_WIDTH).matches;
                  if (!canShowPanel) {
                    router.push(`/jobs/${row.jobId}`);
                    return;
                  }
                  setOpenId(isOpen ? null : row.id);
                }}
                aria-expanded={isOpen}
                className={`flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left transition-colors hover:bg-tag-slate ${
                  isOpen ? "bg-tag-slate" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {row.gcName}
                  </span>
                  <span className="block truncate text-xs text-ink-body">
                    Invoice {row.number} · {row.jobName}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium tabular-nums text-ink">
                    {money(row.outstanding)}
                  </span>
                  <span
                    className={`block text-xs ${
                      row.daysOverdue > 0 ? "text-tag-rose-ink" : "text-ink-body"
                    }`}
                  >
                    {/* The (terms) marker belongs on an overdue row too.
                        A date we derived from the GC's payment terms is a
                        weaker claim than one printed on the invoice, and
                        that matters most at the moment we tell someone
                        they are late — that is the row they will take to
                        the GC. It used to appear only while an invoice was
                        still in date, so the derivation was visible right
                        up until it mattered. */}
                    {row.daysOverdue > 0
                      ? `${row.daysOverdue} ${row.daysOverdue === 1 ? "day" : "days"} overdue${
                          row.dueIsDerived ? " (terms)" : ""
                        }`
                      : row.dueOn
                        ? `Due ${row.dueOn}${row.dueIsDerived ? " (terms)" : ""}`
                        : "No due date"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length > 8 && (
        <p className="mt-2 text-xs text-ink-body">
          and {rows.length - 8} more outstanding.
        </p>
      )}
    </>
  );
}

/** Rendered at the end of the shell's flex row, so opening it narrows the
 * content column instead of covering it. */
export function ReceivablesDetailPanel() {
  const { rows, openId, setOpenId } = useReceivables();
  const open = rows.find((row) => row.id === openId) ?? null;
  if (!open) return null;

  return (
    <SidePanel
          title={`Invoice ${open.number}`}
          subtitle={`${open.gcName} · ${open.jobName}`}
          onClose={() => setOpenId(null)}
          footer={
            <Link
              href={`/jobs/${open.jobId}`}
              className="inline-flex w-full items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Open the job
            </Link>
      }
    >
      <dl className="flex flex-col gap-3">
            <Row label="Invoiced" value={money(open.amount)} />
            <Row label="Paid" value={money(open.paid)} />
            <Row label="Outstanding" value={money(open.outstanding)} emphasis />
            <Row
              label="Due"
              value={
                open.dueOn === null
                  ? "No due date, and no payment terms on file for this GC"
                  : open.dueIsDerived
                    ? `${open.dueOn} — from this GC's payment terms, not stated on the invoice`
                    : open.dueOn
              }
            />
            <Row
              label="Status"
              value={
                open.daysOverdue > 0
                  ? `${open.daysOverdue} ${open.daysOverdue === 1 ? "day" : "days"} overdue`
                  : "Not yet due"
              }
            />
          </dl>

          <div className="mt-5 border-t border-line-card pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-label">
              Actions
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {/* Deliberately disabled rather than absent: these are the
                  two things someone reaches for here, and saying "not
                  built yet" is more useful than pretending the need
                  doesn't exist. Neither has a delivery channel or an
                  activity model behind it — see Sheet 26. */}
              <button
                type="button"
                disabled
                title="No email channel is built yet — Sheet 26"
                className="cursor-not-allowed rounded-md border border-line-card px-3 py-2 text-left text-sm text-ink-muted"
              >
                Send a reminder
                <span className="block text-xs">Not built — no email channel yet</span>
              </button>
              <button
                type="button"
                disabled
                title="No activity log is modelled yet"
                className="cursor-not-allowed rounded-md border border-line-card px-3 py-2 text-left text-sm text-ink-muted"
              >
                Log a call
                <span className="block text-xs">Not built — no activity model yet</span>
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-body">
              Payments are recorded on the job, against this invoice.
            </p>
          </div>
    </SidePanel>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-body">{label}</dt>
      <dd
        className={`text-sm tabular-nums ${
          emphasis ? "font-semibold text-ink" : "text-ink-label"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
