// The change order log a sub sends a GC each month. Pure, and read-only: every
// figure comes from the change order's own value, the same one its card shows.
// Drafts are the sub's working papers, so they are counted and not listed.

import type { ChangeOrderStatus } from "@/components/changeOrderStates";
import { STATUS_LABEL } from "@/components/changeOrderStates";
import type { SheetCell } from "@/lib/sheet-export";

export interface ChangeOrderForLog {
  number: number;
  title: string;
  status: ChangeOrderStatus;
  /** Calendar days, `YYYY-MM-DD`. */
  submittedOn: string | null;
  decidedOn: string | null;
  amount: number;
  revises: number | null;
}

export interface LogRow extends ChangeOrderForLog {
  statusLabel: string;
  /** Days since it went to the GC, for a change order still pending. */
  daysPending: number | null;
}

export const AGING_BANDS = ["0–30 days", "31–60 days", "Over 60 days"] as const;

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function changeOrderLog(changeOrders: readonly ChangeOrderForLog[], today: string) {
  const rows: LogRow[] = changeOrders
    .filter((co) => co.status !== "DRAFT")
    .sort((a, b) => a.number - b.number)
    .map((co) => ({
      ...co,
      statusLabel: STATUS_LABEL[co.status],
      daysPending: co.status === "SUBMITTED" && co.submittedOn ? Math.max(0, days(co.submittedOn, today)) : null,
    }));
  const total = (status: ChangeOrderStatus) => {
    const matching = rows.filter((row) => row.status === status);
    return { count: matching.length, amount: round2(matching.reduce((sum, row) => sum + row.amount, 0)) };
  };
  const pending = rows.filter((row) => row.status === "SUBMITTED");
  const band = (index: number) => {
    const inBand = pending.filter((row) => {
      const age = row.daysPending ?? 0;
      return index === 0 ? age <= 30 : index === 1 ? age > 30 && age <= 60 : age > 60;
    });
    return { label: AGING_BANDS[index], count: inBand.length, amount: round2(inBand.reduce((sum, row) => sum + row.amount, 0)) };
  };
  return {
    rows,
    drafts: changeOrders.filter((co) => co.status === "DRAFT").length,
    totals: { approved: total("APPROVED"), pending: total("SUBMITTED"), rejected: total("REJECTED") },
    aging: [band(0), band(1), band(2)],
  };
}

export type ChangeOrderLog = ReturnType<typeof changeOrderLog>;

/** The sheet: who and when, the rows, then the totals and aging below. */
export function changeOrderLogRows(log: ChangeOrderLog, header: { jobName: string; asOf: string }): SheetCell[][] {
  return [
    ["Change order log", header.jobName],
    ["As of", header.asOf],
    [],
    ["CO", "Title", "Status", "Submitted", "Decided", "Days pending", "Amount", "Revises"],
    ...log.rows.map((row) => [
      row.number,
      row.title,
      row.statusLabel,
      row.submittedOn,
      row.decidedOn,
      row.daysPending,
      row.amount,
      row.revises === null ? null : `CO ${row.revises}`,
    ]),
    [],
    ["Executed", log.totals.approved.count, log.totals.approved.amount],
    ["Pending GC", log.totals.pending.count, log.totals.pending.amount],
    ["Rejected", log.totals.rejected.count, log.totals.rejected.amount],
    [],
    ["Pending, by age"],
    ...log.aging.map((band) => [band.label, band.count, band.amount]),
  ];
}

export function changeOrderLogFileName(jobName: string, asOf: string, format: "csv" | "xlsx") {
  return `Change order log ${jobName.replace(/[\\/:*?"<>|]+/g, "-").trim()} ${asOf}.${format}`;
}
