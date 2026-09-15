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
  INVITED: "bg-neutral-800 text-ink-label",
  SUBMITTED: "bg-tag-blue text-tag-blue-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-red-400",
  DECLINED: "bg-neutral-800 text-ink-muted",
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

  // "No bids match this filter" was shown on a brand-new account, where no
  // filter is set and nothing could match anything. The two states need
  // different sentences and only one of them is a dead end.
  //
  // NO EXTRA QUERY IS NEEDED to tell them apart: with neither filter
  // applied the query above is already unfiltered, so zero rows IS zero
  // bids. A count would be a second read that could only agree.
  const isFiltered = tradeFilter != null || statusFilter != null;

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
          className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
        >
          Filter
        </button>
        {(trade || status) && (
          <Link href="/bids" className="text-sm text-ink-body hover:underline">
            Clear
          </Link>
        )}
      </form>

      {/* "0 bids" above a box that already explains there are none is one
          number doing nothing. It stays for every other case. */}
      {(bids.length > 0 || isFiltered) && (
        <p className="mb-4 text-sm text-ink-body">
          {bids.length} bid{bids.length === 1 ? "" : "s"}
          {wonBids.length > 0 && <> · {money(totalWonValue)} in won bids with a recorded amount</>}
        </p>
      )}

      {bids.length === 0 ? (
        isFiltered ? (
          <p className="text-ink-body">
            No bids match this filter.{" "}
            <Link href="/bids" className="text-link hover:text-brand">
              Show them all
            </Link>
            .
          </p>
        ) : (
          <div className="rounded-lg border border-line-card bg-surface p-6">
            <p className="text-ink-label">No bids logged yet.</p>
            <p className="mt-2 max-w-xl text-sm text-ink-body">
              A bid invitation is logged against the GC who sent it, so this page is the history of
              what you have been asked to price and what it went for. Once a few are in, filtering by
              trade tells you what similar work priced at last time — which is the number you actually
              want when a GC asks for a budget figure on the phone.
            </p>
            <p className="mt-3 text-sm text-ink-body">
              Bids are added from the GC&apos;s own page, under Bid invitations.{" "}
              <Link href="/contacts" className="text-link hover:text-brand">
                Open your contacts
              </Link>{" "}
              and pick the GC, or add them there first.
            </p>
          </div>
        )
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
