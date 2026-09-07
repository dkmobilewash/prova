import Link from "next/link";

import { money } from "@/lib/money";
import {
  CLOSING_SOON_DAYS,
  winRateLabel,
  type PipelineOpportunity,
  type SalesPipeline,
  type StageColumn,
} from "@/lib/sales-pipeline";
import { OPPORTUNITY_STAGE_LABELS } from "@/lib/sales-stage-history";
import { stageTiming } from "@/lib/sales-stage-history";

/**
 * Read-only, so a server component: there is nothing here to click except
 * links out to the leads themselves.
 */

/** "$1,200/mo across 3, 1 unpriced" — the unpriced half never disappears. */
function sliceLabel(count: number, mrr: number, unpriced: number): string {
  if (count === 0) return "none";
  const priced = count - unpriced;
  const head = priced === 0 ? "none priced" : `${money(mrr)}/mo`;
  const tail = unpriced === 0 ? "" : `, ${unpriced} unpriced`;
  return `${head} across ${count}${tail}`;
}

function StageCard({ column }: { column: StageColumn }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs font-medium text-slate-400">
        {OPPORTUNITY_STAGE_LABELS[column.stage]}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-100">{column.count}</p>
      <p className="text-xs text-slate-500">
        {column.count === 0
          ? "nothing here"
          : sliceLabel(column.count, column.mrr, column.unpriced)}
      </p>
      {column.count > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          longest here {stageTiming(column.longestDaysInStage)}
        </p>
      )}
    </div>
  );
}

export function SalesPipelineBand({
  pipeline,
  sittingLongest,
}: {
  pipeline: SalesPipeline;
  sittingLongest: (PipelineOpportunity & { daysInStage: number })[];
}) {
  const total =
    pipeline.open.count + pipeline.won.count + pipeline.lost.count;

  if (total === 0) {
    return (
      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Pipeline</h2>
        <p className="text-xs text-slate-500">
          No opportunities recorded against any lead yet. This fills in as deals are added on a
          lead&apos;s own page.
        </p>
      </section>
    );
  }

  const rate = winRateLabel(pipeline.winRate);

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-100">Pipeline</h2>
      <p className="mb-3 text-xs text-slate-500">
        Every figure worked out from the opportunities themselves, stored nowhere — correcting a
        stage on a lead&apos;s page moves these with it.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {pipeline.columns.map((column) => (
          <StageCard key={column.stage} column={column} />
        ))}
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Open</dt>
          <dd className="text-slate-300">
            {sliceLabel(pipeline.open.count, pipeline.open.mrr, pipeline.open.unpriced)}
          </dd>
        </div>

        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Won / lost</dt>
          <dd className="text-slate-300">
            {pipeline.won.count} / {pipeline.lost.count}
            {/* No rate is not a zero rate. A pipeline with nothing decided
                has no track record, and "0%" would report one. */}
            {rate === null ? (
              <span className="text-slate-600"> — no win rate yet, nothing decided</span>
            ) : (
              <span className="text-slate-400"> — {rate} win rate</span>
            )}
          </dd>
        </div>

        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Past its close date</dt>
          <dd className={pipeline.overdueToClose.count > 0 ? "text-amber-300" : "text-slate-300"}>
            {sliceLabel(
              pipeline.overdueToClose.count,
              pipeline.overdueToClose.mrr,
              pipeline.overdueToClose.unpriced,
            )}
          </dd>
        </div>

        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Closing within {CLOSING_SOON_DAYS} days</dt>
          <dd className="text-slate-300">
            {sliceLabel(
              pipeline.closingSoon.count,
              pipeline.closingSoon.mrr,
              pipeline.closingSoon.unpriced,
            )}
          </dd>
        </div>

        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">No close date given</dt>
          <dd className="text-slate-300">
            {/* "none", not "0". Every other line in this band says none or
                nothing here, and the band's whole design is to keep a
                number from being read as a measurement — a bare 0 sitting
                under three money figures is exactly that. Reported from a
                browser run on 2026-09-04 as the one place it spoke in
                digits. */}
            {pipeline.openWithoutCloseDate === 0 ? (
              "none"
            ) : (
              <>
                {pipeline.openWithoutCloseDate}
                <span className="text-slate-600"> — not counted in either line above</span>
              </>
            )}
          </dd>
        </div>
      </dl>

      {sittingLongest.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="mb-1 text-xs font-medium text-slate-400">Sitting longest</p>
          <ul className="space-y-1">
            {sittingLongest.map((opportunity) => (
              <li key={opportunity.id} className="flex justify-between gap-3 text-xs">
                <Link
                  href={`/sales/${opportunity.leadId}`}
                  className="text-slate-300 hover:underline"
                >
                  {opportunity.companyName}
                </Link>
                <span className="text-slate-500">
                  {OPPORTUNITY_STAGE_LABELS[opportunity.stage]} · {stageTiming(opportunity.daysInStage)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-600">
        There is no weighted forecast here on purpose. The usual one multiplies each stage by a
        probability, and nobody has supplied those numbers — a dollar figure derived from invented
        odds would look more certain than anything we actually know. The close-date lines above are
        read off the dates somebody entered.
      </p>
    </section>
  );
}
