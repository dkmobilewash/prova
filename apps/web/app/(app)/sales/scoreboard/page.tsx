import Link from "next/link";
import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { PageHeader } from "@/components/PageHeader";
import { requireCompanyContext } from "@/lib/auth";
import { viewerTimeZone } from "@/lib/viewerToday";
import { todayInZone } from "@/lib/viewer-timezone";
import {
  byDay,
  byDoor,
  coldIsDead,
  DOOR_LABEL,
  DOORS,
  FILES_RECEIVED_PREFIX,
  KILL_LINE,
  per100,
  POSITIVE_CLASSES,
  slackSummary,
  tally,
  todayBoard,
  windowDays,
  type Counts,
  type Door,
} from "@/lib/outbound-scoreboard";

export const metadata = { title: "Outbound scoreboard" };

/**
 * WHAT WENT OUT AND WHAT CAME BACK — the three-door test as it runs.
 *
 * Operator-owner only, the same two checks as /sales, for the same reason: a
 * capability would loosen it. Read-only: every number is derived at request
 * time (lib/outbound-scoreboard.ts) from rows the webhook, the reply agent
 * and the call buttons already write. Nothing on this page writes.
 */

const WINDOWS = [7, 14, 30] as const;
const COLUMNS: { key: keyof Counts | "delivered" | "rate"; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered-ish" },
  { key: "replies", label: "Replies" },
  { key: "positive", label: "Positive" },
  { key: "rate", label: "Positive / 100" },
  { key: "suppressed", label: "Suppressed" },
  { key: "meetings", label: "Meetings" },
  { key: "files", label: "Files" },
];

function cellValue(c: Counts, key: (typeof COLUMNS)[number]["key"]): string {
  if (key === "delivered") return String(c.sent - c.bounced);
  if (key === "rate") {
    const r = per100(c.positive, c.sent);
    return r === null ? "—" : r.toFixed(1);
  }
  return String(c[key]);
}

function CountRow({ label, counts, href }: { label: string; counts: Counts; href?: string }) {
  return (
    <tr className="border-t border-line-row">
      <td className="py-1.5 pr-3 text-ink-label">
        {href ? (
          <Link href={href} className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </td>
      {COLUMNS.map((col) => (
        <td key={col.key} className="py-1.5 pr-3 text-right tabular-nums text-ink">
          {cellValue(counts, col.key)}
        </td>
      ))}
    </tr>
  );
}

function CountTable({ first, rows }: { first: string; rows: { label: string; counts: Counts; href?: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="text-xs text-ink-muted">
            <th className="pb-1 pr-3 font-normal">{first}</th>
            {COLUMNS.map((col) => (
              <th key={col.key} className="pb-1 pr-3 text-right font-normal">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CountRow key={row.label} {...row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-lg border border-line-card bg-surface px-3 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      {note && <div className="text-xs text-ink-muted">{note}</div>}
    </div>
  );
}

export default async function ScoreboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { company, ...currentUser } = await requireCompanyContext();
  const parent = { href: "/sales/scoreboard", label: "Scoreboard" };
  if (!company.isProvaOperator) {
    return (
      <PageShell width="reading">
        <PageHeader route="/sales" parent={parent} title="Not part of your access" />
        <p className="text-sm text-ink-body">Nothing here for this account.</p>
      </PageShell>
    );
  }
  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <PageHeader route="/sales" parent={parent} title="Owner only" />
        <p className="text-sm text-ink-body">The sales CRM is restricted to the account owner.</p>
      </PageShell>
    );
  }

  const requested = Number((await searchParams).days);
  const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 7;
  const zone = await viewerTimeZone();
  const today = todayInZone(zone);
  const window = windowDays(today, days);
  // One day of slack either side: the viewer's day and UTC disagree by up to a day.
  const since = new Date(new Date(`${window[window.length - 1]}T00:00:00.000Z`).getTime() - 86_400_000);

  const [events, replies, activities, repliesWaiting, latestPositive] = await Promise.all([
    prisma.outboundEvent.findMany({
      where: { companyId: company.id, OR: [{ occurredAt: { gte: since } }, { occurredAt: null, createdAt: { gte: since } }] },
      select: { id: true, type: true, leadId: true, payload: true, occurredAt: true, createdAt: true },
    }),
    prisma.outboundReply.findMany({
      where: { companyId: company.id, receivedAt: { gte: since } },
      select: {
        eventId: true,
        leadId: true,
        classification: true,
        door: true,
        status: true,
        receivedAt: true,
        lead: { select: { companyName: true } },
      },
    }),
    prisma.salesActivity.findMany({
      where: {
        companyId: company.id,
        occurredOn: { gte: since },
        OR: [{ type: { in: ["CALL", "MEETING", "DEMO"] } }, { type: "NOTE", summary: { startsWith: FILES_RECEIVED_PREFIX } }],
      },
      select: { type: true, leadId: true, occurredOn: true, summary: true },
    }),
    prisma.outboundReply.count({ where: { companyId: company.id, status: "PENDING_REVIEW" } }),
    prisma.outboundReply.findMany({
      where: { companyId: company.id, classification: { in: [...POSITIVE_CLASSES] as ("INTERESTED" | "SEND_INFO")[] } },
      orderBy: { receivedAt: "desc" },
      take: 10,
      select: {
        id: true,
        leadId: true,
        door: true,
        classification: true,
        receivedAt: true,
        lead: { select: { companyName: true } },
      },
    }),
  ]);

  const replyRecords = replies.map((r) => ({ ...r, companyName: r.lead.companyName }));
  const cells = tally({ events, replies: replyRecords, activities }, zone);
  const doorCounts = byDoor(cells, new Set(window));
  const dayRows = byDay(cells, window);
  const board = todayBoard({ cells, calls: activities, repliesWaiting }, today);
  const windowSent = DOORS.reduce((n, d) => n + doorCounts[d].sent, 0);
  const windowPositive = DOORS.reduce((n, d) => n + doorCounts[d].positive, 0);
  const windowFiles = DOORS.reduce((n, d) => n + doorCounts[d].files, 0);
  // Files are the line's own signal; positive replies stand in only until the first file is logged.
  const lineOn = windowFiles > 0 ? { n: windowFiles, what: "files" } : { n: windowPositive, what: "positive (no files logged yet; positive replies stand in)" };
  const dead = coldIsDead(windowSent, lineOn.n);

  return (
    <PageShell width="working">
      <PageHeader
        route="/sales"
        parent={parent}
        title="Outbound scoreboard"
        subtitle={<>Today is {today} on your calendar ({zone}). Every number is counted from the rows as they stand; nothing here is stored.</>}
      />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-ink">Today</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Dials" value={board.calls.dials} />
          <Stat label="Answered" value={board.calls.connects} note="any human, gatekeeper included" />
          <Stat label="Conversations" value={board.calls.conversations} />
          <Stat label="Want-me-to yeses" value={board.calls.wantsReport} note="Yes to the free one, on a call" />
          <Stat label="Meetings booked" value={board.calls.meetings + board.email.meetings} note="call tag + MEETING/DEMO logged" />
          <Stat label="Emails sent" value={board.email.sent} />
          <Stat label="Replies" value={board.email.replies} />
          <Stat label="Positive replies" value={board.email.positive} note="INTERESTED + SEND_INFO" />
          <Stat label="Files received" value={board.email.files} note="Files received button on a lead or a reply" />
          <Stat label="Suppressed" value={board.email.suppressed} note="STOP + unsubscribe" />
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">By door, last {days} days</h2>
          <span className="flex gap-2 text-xs">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/sales/scoreboard?days=${w}`}
                aria-current={w === days ? "page" : undefined}
                className={`rounded px-2 py-0.5 ${w === days ? "bg-tag-brand text-tag-brand-ink" : "text-ink-label hover:underline"}`}
              >
                {w}d
              </Link>
            ))}
          </span>
        </div>
        <CountTable
          first="Door"
          rows={DOORS.map((d: Door) => ({ label: DOOR_LABEL[d], counts: doorCounts[d] }))}
        />
        <p className="mt-2 text-xs text-ink-muted">
          {/* TODO(cyrus/letters): Letters row — PublicWorksLetter lands with cyrus/letters; count sent letters per day here. */}
          Letters: lands with cyrus/letters. Kill line: under {KILL_LINE.per100} file per 100 after {KILL_LINE.afterSent} firms = dead
          for cold.{" "}
          {dead === null
            ? `${windowSent} of ${KILL_LINE.afterSent} sent in this window — not decided yet.`
            : `${lineOn.n} ${lineOn.what} on ${windowSent} sent — ${dead ? "UNDER" : "above"} the line.`}
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-ink">By day</h2>
        <CountTable first="Day" rows={dayRows.map((r) => ({ label: r.day, counts: r.counts }))} />
      </section>

      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Latest positive replies</h2>
          <Link href="/sales/replies" className="text-xs text-ink-label hover:underline">
            {repliesWaiting} waiting for you →
          </Link>
        </div>
        {latestPositive.length === 0 ? (
          <p className="text-sm text-ink-body">No positive reply yet. They land here as prospects write back.</p>
        ) : (
          <ul className="divide-y divide-line-row text-sm">
            {latestPositive.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <Link href={`/sales/${r.leadId}`} className="text-ink-label hover:underline">
                  {r.lead.companyName}
                </Link>
                <span className="text-xs text-ink-muted">
                  {DOOR_LABEL[r.door]} · {r.classification} · {r.receivedAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Copy for Slack</h2>
        <pre className="overflow-x-auto rounded-lg border border-line-card bg-surface p-3 text-xs text-ink-body">
          {slackSummary(board, today)}
        </pre>
      </section>
    </PageShell>
  );
}
