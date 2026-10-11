import Link from "next/link";
import { money } from "@/lib/money";
import { dueStatus } from "@/lib/due-date";
import { NEW_PAY_APP_HASH, payAppBar, payAppPrimaryLabel, type PayAppFigures } from "@/components/job/payAppFigures";

export type PayAppSummaryProps = {
  jobId: string;
  gcName: string;
  /** The number the next invoice will take — invoices and pay applications
   * share one per-job counter (InvoiceCounter), so this is that counter + 1,
   * not the last pay app's number + 1. */
  nextNumber: number;
  /** The latest pay application on the job, or null when there is none. */
  payApp: {
    id: string;
    number: number;
    /** Month the application was issued, already in the viewer's zone, with
     * the year when it is not this year (`payAppMonth`). */
    month: string;
    dueAt: Date | null;
    status: string;
    figures: PayAppFigures;
  } | null;
  /** The viewer's calendar day at UTC midnight (`viewerAsOf()`), for the
   * due pill. Never the server's clock: lib/due-date.ts. */
  asOf: Date;
};

const label = "text-xs uppercase tracking-[0.06em] text-ink-muted";
const big = "mt-1 block font-headline text-[32px] leading-[1.1] tabular-nums text-ink sm:text-[38px]";
const sub = "text-sm text-ink-muted";
const button =
  "inline-flex min-h-[46px] w-full items-center justify-center rounded-[10px] px-[22px] py-2 text-center text-[15px] font-semibold sm:w-auto";

function StatusPill({ status, dueAt, asOf }: { status: string; dueAt: Date | null; asOf: Date }) {
  if (status === "PAID") {
    return <span className="rounded-full bg-tag-green px-2.5 py-1 text-[13px] font-semibold text-tag-green-ink">Paid</span>;
  }
  if (status === "DISPUTED") {
    return <span className="rounded-full bg-tag-rose px-2.5 py-1 text-[13px] font-semibold text-tag-rose-ink">Disputed</span>;
  }
  if (!dueAt) return null;
  const due = dueStatus(dueAt, asOf);
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${
        due.overdue ? "bg-tag-rose text-tag-rose-ink" : "bg-tag-amber text-tag-amber-ink"
      }`}
    >
      {due.text.charAt(0).toUpperCase() + due.text.slice(1)}
    </span>
  );
}

/**
 * The top of the Billing stage: where the current pay application stands,
 * in the three numbers a sub actually asks about. Every figure comes from
 * `payAppFigures`, i.e. from the certificate the Review page prints.
 */
export function PayAppSummary({ jobId, gcName, nextNumber, payApp, asOf }: PayAppSummaryProps) {
  if (!payApp) {
    return (
      <section className="mb-6 rounded-[14px] border border-line-card bg-surface p-5 sm:px-7 sm:py-5">
        <h2 className="font-headline text-2xl leading-none text-ink">No pay application yet</h2>
        <p className="mt-3 max-w-xl text-sm text-ink-body">
          A pay application bills {gcName} against this job&rsquo;s schedule of values, line by line. Nothing is sent
          until you submit it.
        </p>
        <a href={NEW_PAY_APP_HASH} className={`${button} mt-5 bg-brand text-neutral-900 hover:bg-brand-hover`}>
          Start pay app #{nextNumber}
        </a>
      </section>
    );
  }

  const f = payApp.figures;
  const bar = payAppBar(f);
  const ofContract = f.contractSum > 0 ? Math.round((f.thisPeriod / f.contractSum) * 100) : null;

  return (
    <section className="mb-6 rounded-[14px] border border-line-card bg-surface p-5 sm:px-7 sm:py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-headline text-2xl leading-none text-ink">
          Pay application #{payApp.number} · {payApp.month}
        </h2>
        <StatusPill status={payApp.status} dueAt={payApp.dueAt} asOf={asOf} />
      </div>

      <dl className="grid grid-cols-1 border-y border-line-row sm:grid-cols-3">
        <div className="py-4">
          <dt className={label}>This period</dt>
          <dd>
            <strong className={big}>{money(f.thisPeriod)}</strong>
            {ofContract !== null && <span className={sub}>{ofContract}% of contract</span>}
          </dd>
        </div>
        <div className="border-t border-line-row py-4 sm:border-l sm:border-t-0 sm:pl-7">
          <dt className={label}>Retainage held</dt>
          <dd>
            <strong className={big}>{money(f.retainageHeld)}</strong>
            <span className={sub}>to date, released at closeout</span>
          </dd>
        </div>
        <div className="border-t border-line-row py-4 sm:border-l sm:border-t-0 sm:pl-7">
          <dt className={label}>You&rsquo;ll be paid</dt>
          <dd>
            <strong className={big}>{money(f.youllBePaid)}</strong>
            <span className={sub}>this application, after retainage</span>
          </dd>
        </div>
      </dl>

      <div className="mb-2 mt-4 flex h-2.5 overflow-hidden rounded-[5px] bg-line-row" aria-hidden="true">
        <span className="h-full bg-ink-muted" style={{ width: `${bar.before}%` }} />
        <span className="h-full border-y-[5px] border-brand" style={{ width: `${bar.thisPeriod}%` }} />
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <li className="inline-flex items-center gap-2">
          <i className="inline-block size-2.5 rounded-[3px] bg-ink-muted" aria-hidden="true" />
          Billed before · {money(f.billedBefore)}
        </li>
        <li className="inline-flex items-center gap-2">
          <i className="inline-block size-2.5 rounded-[3px] border-[5px] border-brand" aria-hidden="true" />
          This period · {money(f.thisPeriod)}
        </li>
        <li className="inline-flex items-center gap-2">
          <i className="inline-block size-2.5 rounded-[3px] border border-line-card bg-line-row" aria-hidden="true" />
          Left · {money(f.left)}
        </li>
      </ul>

      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href={`/jobs/${jobId}/pay-applications/${payApp.id}`}
          className={`${button} bg-brand text-neutral-900 hover:bg-brand-hover`}
        >
          {payAppPrimaryLabel(payApp.status, payApp.number, gcName)}
        </Link>
        {/* NOT "Edit line items": a submitted pay application is not
            editable here, and the schedule of values sits behind a different
            capability (VIEW_JOB_COSTS) than this tab (MANAGE_BILLING), so a
            link to it would be a door some billing users cannot open. The
            next application is what this person can actually do. */}
        <a
          href={NEW_PAY_APP_HASH}
          className={`${button} border border-line-card text-ink hover:bg-rail-hover`}
        >
          Start pay app #{nextNumber}
        </a>
      </div>
    </section>
  );
}
