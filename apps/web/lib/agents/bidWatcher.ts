import { prisma } from "@prova/db";
import { formatCalendarDate } from "@/lib/render-date";
import { addFinding, type NewFinding } from "./core";
import { notifyFindings } from "./notify";
import { AGENT_RUNNERS, type AgentContext } from "./run";

/**
 * THE BID WATCHER — a daily look at bid data C Stream already holds.
 *
 * DETERMINISTIC, NO MODEL CALL. Everything it says is a comparison of a
 * stored date or a stored count against today, so there is nothing for a
 * model to add and no spend to record. (It still goes through runAgent, so
 * the AI switch and the spend cap gate it like every other agent — a
 * company that turned AI off has asked for no agents, not "no expensive
 * agents".)
 *
 * What it looks at:
 *   - new_invitation (info)   BidInvitation created since the last DONE run;
 *   - new_addendum   (info)   BidAddendum created since then that somebody
 *                             has already read or acknowledged;
 *   - unread_addendum (flag)  an addendum on an open bid with no reading, no
 *                             scope decision and no acknowledged date;
 *   - due_soon       (warn)   an INVITED bid due today..today+dueSoonDays;
 *   - pursuit_due_soon (warn) a pursuit with no invitation yet whose expected
 *                             bid date falls in the same window;
 *   - past_due       (flag)   an INVITED bid whose due date has passed.
 *
 * Bid-related email intake: NONE exists (DocumentIntakeKind has no bid
 * kind), so nothing here reads intake.
 *
 * Repeats are skipped by dedupeKey. A key carries the FACT, not just the
 * subject — `due_soon:<bid>:<date>` — so a moved due date is a new finding
 * and the same date is not said twice.
 *
 * "Today" is the UTC calendar day, the same day the stored UTC-midnight
 * dates are on. The cron runs at 12:23 UTC, which is the same calendar day
 * across the US, so "past due" never fires on a bid due later today there.
 */

const DAY_MS = 86_400_000;

/** How far back the very first run looks for "new" invitations and
 *  addenda. Without a floor, a company's first run would announce every bid
 *  it ever logged as new. */
export const FIRST_RUN_LOOKBACK_DAYS = 7;

export function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const bidHref = (id: string) => `/bids#${id}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function daysWord(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

type Bid = { id: string; projectName: string; dueDate: Date | null; contactId: string; contact: { name: string } };

function bidSources(bid: Bid) {
  return [
    { label: bid.projectName, href: bidHref(bid.id), recordType: "BidInvitation", recordId: bid.id },
    { label: bid.contact.name, href: `/contacts/${bid.contactId}`, recordType: "Contact", recordId: bid.contactId },
  ];
}

/** Every finding this run should make, before dedupe. Pure over its inputs
 *  apart from the reads, so the test drives it with fixtures. */
export async function watcherFindings(
  companyId: string,
  dueSoonDays: number,
  since: Date,
  now: Date,
): Promise<NewFinding[]> {
  const today = utcDay(now);
  const horizon = new Date(today.getTime() + dueSoonDays * DAY_MS);
  const bidSelect = { id: true, projectName: true, dueDate: true, contactId: true, contact: { select: { name: true } } };

  const [newBids, openDated, addenda, pursuits] = await Promise.all([
    prisma.bidInvitation.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: { ...bidSelect, status: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bidInvitation.findMany({
      where: { companyId, status: "INVITED", dueDate: { not: null, lte: horizon } },
      select: bidSelect,
      orderBy: { dueDate: "asc" },
    }),
    prisma.bidAddendum.findMany({
      where: { companyId, bidInvitation: { status: "INVITED" } },
      select: {
        id: true,
        reference: true,
        issuedOn: true,
        acknowledgedOn: true,
        createdAt: true,
        bidInvitation: { select: bidSelect },
        _count: { select: { readings: true, decisions: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bidPursuit.findMany({
      where: {
        companyId,
        bidInvitationId: null,
        stage: { not: "DROPPED" },
        expectedBidDate: { gte: today, lte: horizon },
      },
      select: { id: true, projectName: true, expectedBidDate: true, expectedGcs: true },
      orderBy: { expectedBidDate: "asc" },
    }),
  ]);

  const out: NewFinding[] = [];

  for (const bid of newBids) {
    const due = bid.dueDate ? `, due ${formatCalendarDate(bid.dueDate)}` : ", no due date entered";
    out.push({
      kind: "new_invitation",
      severity: "info",
      title: `New invitation: ${bid.projectName}`,
      body: `${bid.contact.name} invited you to bid ${bid.projectName}${due}.`,
      sources: bidSources(bid),
      fixHref: bidHref(bid.id),
      bidInvitationId: bid.id,
      dedupeKey: `new_invitation:${bid.id}`,
    });
  }

  for (const bid of openDated) {
    const due = bid.dueDate!;
    const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
    if (days < 0) {
      out.push({
        kind: "past_due",
        severity: "flag",
        title: `Past due, still not submitted: ${bid.projectName}`,
        body: `${bid.projectName} for ${bid.contact.name} was due ${formatCalendarDate(due)} (${plural(-days, "day")} ago) and is still marked Invited. Mark it submitted, declined or lost so the list is true.`,
        sources: bidSources(bid),
        fixHref: bidHref(bid.id),
        bidInvitationId: bid.id,
        dedupeKey: `past_due:${bid.id}:${isoDay(due)}`,
      });
    } else {
      out.push({
        kind: "due_soon",
        severity: "warn",
        title: `Due ${daysWord(days)}: ${bid.projectName}`,
        body: `${bid.projectName} for ${bid.contact.name} is due ${formatCalendarDate(due)} and is still marked Invited.`,
        sources: bidSources(bid),
        fixHref: bidHref(bid.id),
        bidInvitationId: bid.id,
        dedupeKey: `due_soon:${bid.id}:${isoDay(due)}`,
      });
    }
  }

  for (const a of addenda) {
    const bid = a.bidInvitation;
    const sources = [
      { label: `Addendum ${a.reference}`, href: bidHref(bid.id), recordType: "BidAddendum", recordId: a.id },
      ...bidSources(bid),
    ];
    const issued = a.issuedOn ? `, issued ${formatCalendarDate(a.issuedOn)}` : "";
    const unread = a._count.readings === 0 && a._count.decisions === 0 && a.acknowledgedOn === null;
    if (unread) {
      out.push({
        kind: "unread_addendum",
        severity: "flag",
        title: `Addendum not looked at: ${a.reference} on ${bid.projectName}`,
        body: `Addendum ${a.reference}${issued} on ${bid.projectName} has not been read, acknowledged or sorted into your scope yet.`,
        sources,
        fixHref: bidHref(bid.id),
        bidInvitationId: bid.id,
        dedupeKey: `unread_addendum:${a.id}`,
      });
    } else if (a.createdAt >= since) {
      out.push({
        kind: "new_addendum",
        severity: "info",
        title: `New addendum: ${a.reference} on ${bid.projectName}`,
        body: `Addendum ${a.reference}${issued} was logged on ${bid.projectName}.`,
        sources,
        fixHref: bidHref(bid.id),
        bidInvitationId: bid.id,
        dedupeKey: `new_addendum:${a.id}`,
      });
    }
  }

  for (const p of pursuits) {
    const date = p.expectedBidDate!;
    const days = Math.round((date.getTime() - today.getTime()) / DAY_MS);
    const gcs = p.expectedGcs ? ` Expected GCs: ${p.expectedGcs}.` : "";
    out.push({
      kind: "pursuit_due_soon",
      severity: "warn",
      title: `Expected to bid ${daysWord(days)}, no invitation yet: ${p.projectName}`,
      body: `You expected ${p.projectName} to bid ${formatCalendarDate(date)} and no invitation is logged against it.${gcs}`,
      sources: [{ label: p.projectName, href: "/pipeline", recordType: "BidPursuit", recordId: p.id }],
      fixHref: "/pipeline",
      dedupeKey: `pursuit_due_soon:${p.id}:${isoDay(date)}`,
    });
  }

  return out;
}

export async function runBidWatcher(ctx: AgentContext, now: Date = new Date()): Promise<{ summary: string }> {
  const last = await prisma.agentRun.findFirst({
    where: { companyId: ctx.companyId, agent: "BID_WATCHER", status: "DONE", id: { not: ctx.run.id } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const since = last?.startedAt ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_DAYS * DAY_MS);

  const findings = await watcherFindings(ctx.companyId, ctx.settings.dueSoonDays, since, now);
  const created: NewFinding[] = [];
  for (const f of findings) {
    if (await addFinding(ctx.run, f)) created.push(f);
  }
  await notifyFindings(ctx.companyId, created, ctx.settings);

  const count = (kind: string) => findings.filter((f) => f.kind === kind).length;
  const parts = [
    count("due_soon") && `${plural(count("due_soon"), "bid")} due in the next ${ctx.settings.dueSoonDays} days`,
    count("past_due") && `${count("past_due")} past due`,
    count("unread_addendum") && plural(count("unread_addendum"), "unread addendum", "unread addenda"),
    count("new_addendum") && plural(count("new_addendum"), "new addendum", "new addenda"),
    count("new_invitation") && plural(count("new_invitation"), "new invitation"),
    count("pursuit_due_soon") && `${plural(count("pursuit_due_soon"), "pursuit")} expected to bid soon`,
  ].filter(Boolean);
  const said = created.length === findings.length ? "" : ` (${plural(created.length, "new finding")})`;
  return { summary: parts.length ? `${parts.join(", ")}${said}.` : "Nothing needs you on open bids." };
}

AGENT_RUNNERS.BID_WATCHER = (ctx) => runBidWatcher(ctx);
