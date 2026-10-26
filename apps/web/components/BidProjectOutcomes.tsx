import { formatCalendarDate } from "@/lib/render-date";
import { money } from "@/lib/money";
import { DIDNT_GET_THE_JOB } from "@/lib/bid-projects";
import { gcPriceViews, type ProjectRow } from "@/lib/bid-project-view";

const STATUS_WORD: Record<string, string> = {
  INVITED: "Invited",
  SUBMITTED: "Submitted",
  WON: "Won",
  LOST: "Lost",
  DECLINED: "Declined",
};

const STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-rail-hover text-ink-label",
  SUBMITTED: "bg-tag-brand text-tag-brand-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-danger",
  DECLINED: "bg-rail-hover text-ink-muted",
};

/**
 * ONE PROJECT'S OUTCOMES: its name, its bid date and, for every GC on it, the
 * status and the price. Read-only and link-free on purpose, so the CRM's /bids
 * (above the rows) and C Stream Bid's list render the same words.
 *
 * The price is what that GC is QUOTED - the estimate's total plus its own
 * adjustment, worked out here from the rows and never read from a column - and
 * "sent" is what a person recorded as actually sent. Both show when both exist,
 * because they can honestly differ. A GC whose project went to a different
 * prime reads "Didn't get the job", never "Lost".
 */
export function BidProjectOutcomes({ project, headingLevel = 3 }: { project: ProjectRow; headingLevel?: 2 | 3 }) {
  const { estimateTotal, rows } = gcPriceViews(project, null, money);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div data-bids="project-outcomes">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className="font-semibold text-ink" data-bids="project-heading">
          {project.name}
        </Heading>
        <p className="text-sm text-ink-body">
          {project.bidDueDate ? <>Bid date {formatCalendarDate(project.bidDueDate, "numeric")}</> : "No bid date"}
          {estimateTotal !== null && <> · Estimate {money(estimateTotal)}</>}
        </p>
      </div>
      <ul className="mt-1 space-y-1">
        {rows.map((row) => (
          <li key={row.invitationId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-bids="outcome-row">
            <span className="font-medium text-ink">{row.name}</span>
            {row.didntGetTheJob && row.status !== "WON" ? (
              <span className="inline-flex items-center rounded-full bg-rail-hover px-2 py-0.5 text-xs font-medium text-ink-label">
                {DIDNT_GET_THE_JOB}
              </span>
            ) : (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.status] ?? ""}`}>
                {STATUS_WORD[row.status] ?? row.status}
              </span>
            )}
            <span className="tabular-nums text-ink-body" data-bids="outcome-price">
              {row.sent && row.price && row.sentDollars !== row.priceDollars ? (
                <>
                  {row.sent} sent <span className="text-ink-muted">(quoted {row.price})</span>
                </>
              ) : row.sent ? (
                <>{row.sent} sent</>
              ) : row.price ? (
                <>{row.price} quoted</>
              ) : row.problem ? (
                <span className="text-tag-amber-ink">check the adjustment</span>
              ) : (
                <span className="text-ink-muted">no price yet</span>
              )}
              {row.adjustment && <span className="text-ink-muted"> · {row.adjustment}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
