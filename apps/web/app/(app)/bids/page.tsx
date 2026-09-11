import Link from "next/link";
import { BidInvitationStatus, prisma, TradeScope } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";

const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

const STATUS_OPTIONS = [
  { value: "INVITED", label: "Invited" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "DECLINED", label: "Declined" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-neutral-100 text-ink-label",
  SUBMITTED: "bg-tag-blue text-tag-blue-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-red-600",
  DECLINED: "bg-neutral-100 text-ink-muted",
};

function labelFor(options: readonly { value: string; label: string }[], value: string | null) {
  return options.find((o) => o.value === value)?.label ?? value;
}

export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; status?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;
  const { trade, status } = await searchParams;

  const tradeFilter = trade && trade in TradeScope ? (trade as TradeScope) : undefined;
  const statusFilter = status && status in BidInvitationStatus ? (status as BidInvitationStatus) : undefined;

  const bids = await prisma.bidInvitation.findMany({
    where: {
      companyId: company.id,
      tradeScope: tradeFilter,
      status: statusFilter,
    },
    orderBy: { createdAt: "desc" },
    include: { contact: true },
  });

  const wonBids = bids.filter((b) => b.status === "WON" && b.bidAmount != null);
  const totalWonValue = wonBids.reduce((sum, b) => sum + Number(b.bidAmount), 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Bid history</h1>
      <p className="mb-6 text-sm text-ink-body">
        Every bid invitation logged across every GC — filter by trade or outcome to see what similar
        work has priced at before.
      </p>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Trade
          <select
            name="trade"
            defaultValue={trade ?? ""}
            className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="">All trades</option>
            {TRADE_SCOPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-100"
        >
          Filter
        </button>
        {(trade || status) && (
          <Link href="/bids" className="text-sm text-ink-body hover:underline">
            Clear
          </Link>
        )}
      </form>

      <p className="mb-4 text-sm text-ink-body">
        {bids.length} bid{bids.length === 1 ? "" : "s"}
        {wonBids.length > 0 && <> · {money(totalWonValue)} in won bids with a recorded amount</>}
      </p>

      {bids.length === 0 ? (
        <p className="text-ink-body">No bids match this filter.</p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {bids.map((bid) => (
            <li key={bid.id} className="p-4">
              <Link
                href={`/contacts/${bid.contactId}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{bid.projectName}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[bid.status]}`}
                    >
                      {labelFor(STATUS_OPTIONS, bid.status)}
                    </span>
                  </div>
                  <p className="text-sm text-ink-body">
                    {bid.contact.name}
                    {bid.tradeScope && <> · {labelFor(TRADE_SCOPE_OPTIONS, bid.tradeScope)}</>}
                    {bid.dueDate && <> · Due {formatCalendarDate(bid.dueDate, "numeric")}</>}
                  </p>
                </div>
                {bid.bidAmount != null && (
                  <p className="text-sm font-medium text-ink">{money(Number(bid.bidAmount))}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
