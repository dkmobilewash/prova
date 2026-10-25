import type { BidLog, BidLogRecord } from "@/lib/bid-pipeline";
import { percentLabel } from "@/lib/bid-pipeline";
import { money } from "@/lib/money";

/**
 * The bid log on /pipeline: the figures a sub keeps by hand — bids per month,
 * average bid, win rate, contracts won and average contract — by period.
 *
 * A server component that only renders `summariseBidLog`'s result. Every
 * definition (what a bid is, which month it falls in, what a contract's value
 * is) lives in `lib/bid-pipeline.ts`, and the footnote here says the parts a
 * person needs to read the numbers right: undated bids, unpriced bids, and
 * wins with no contract on file are COUNTED and named, never averaged in as $0.
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" from "2026-10". */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

const cell = "px-3 py-2 text-right tabular-nums";
const head = "px-3 py-2 text-right font-medium text-ink-label";

function Row({ label, record }: { label: string; record: BidLogRecord }) {
  return (
    <tr className="border-t border-line-row">
      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
        {label}
      </th>
      <td className={cell}>{record.bids}</td>
      <td className={cell}>{record.averageBid === null ? "—" : money(record.averageBid)}</td>
      <td className={cell}>
        {record.won}
        {record.won + record.lost > 0 && <span className="text-ink-muted"> of {record.won + record.lost}</span>}
      </td>
      <td className={cell}>{percentLabel(record.winRate)}</td>
      <td className={cell}>{record.averageContract === null ? "—" : money(record.averageContract)}</td>
    </tr>
  );
}

function Table({ rows, caption }: { rows: { label: string; record: BidLogRecord }[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line-card bg-surface">
      <table className="w-full min-w-[560px] text-sm text-ink-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium text-ink-label">
              Period
            </th>
            <th scope="col" className={head}>
              Bids
            </th>
            <th scope="col" className={head}>
              Average bid
            </th>
            <th scope="col" className={head}>
              Won of decided
            </th>
            <th scope="col" className={head}>
              Win rate
            </th>
            <th scope="col" className={head}>
              Average contract
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.label} label={row.label} record={row.record} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BidLogPanel({ log }: { log: BidLog }) {
  const { allTime, last12Months } = log;
  const perMonth = log.bidsPerMonth.toFixed(1).replace(/\.0$/, "");
  const notes: string[] = [];
  if (log.noDueDate > 0) {
    notes.push(
      `${log.noDueDate} ${log.noDueDate === 1 ? "bid has" : "bids have"} no due date, so ${log.noDueDate === 1 ? "it is" : "they are"} counted in All time only.`,
    );
  }
  if (allTime.unpricedBids > 0) {
    notes.push(
      `${allTime.unpricedBids} ${allTime.unpricedBids === 1 ? "bid has" : "bids have"} no amount and ${allTime.unpricedBids === 1 ? "is" : "are"} left out of the average bid.`,
    );
  }
  if (allTime.wonWithoutContract > 0) {
    notes.push(
      `${allTime.wonWithoutContract} won ${allTime.wonWithoutContract === 1 ? "bid has" : "bids have"} no contract on file — no linked job, or a job with no priced lines — and ${allTime.wonWithoutContract === 1 ? "is" : "are"} left out of the average contract.`,
    );
  }

  return (
    <section className="mb-8" data-pipeline="bid-log">
      <h2 className="mb-1 text-sm font-medium text-ink-label">Bid log</h2>
      <p className="mb-3 text-sm text-ink-body" data-pipeline="bid-log-headline">
        Last 12 months: {last12Months.bids} {last12Months.bids === 1 ? "bid" : "bids"} ({perMonth} a month)
        {last12Months.averageBid !== null && <>, averaging {money(last12Months.averageBid)}</>}
        {" · "}
        {last12Months.won + last12Months.lost === 0
          ? "none decided yet"
          : `won ${last12Months.won} of ${last12Months.won + last12Months.lost} decided (${percentLabel(last12Months.winRate)})`}
        {last12Months.averageContract !== null && <> · average contract {money(last12Months.averageContract)}</>}
      </p>
      <Table
        caption="Bid log by period"
        rows={[
          { label: "Last 12 months", record: last12Months },
          { label: "This year", record: log.thisYear },
          { label: "All time", record: allTime },
        ]}
      />
      <details className="mt-3" data-pipeline="bid-log-months">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-link hover:underline mouse:min-h-0">
          Month by month
        </summary>
        <div className="mt-2">
          <Table
            caption="Bid log by month"
            rows={log.byMonth.map((month) => ({ label: monthLabel(month.month), record: month.record }))}
          />
        </div>
      </details>
      <p className="mt-3 text-xs text-ink-muted">
        A bid is one you priced — submitted, won or lost — and falls in the month it was due. Win rate is won out of
        won plus lost; bids still waiting on the GC are not losses. A contract is a won bid, valued at its linked
        job&apos;s line items.{notes.length > 0 && <> {notes.join(" ")}</>}
      </p>
    </section>
  );
}
