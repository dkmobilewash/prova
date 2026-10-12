import { prisma } from "@prova/db";
import { canReach, can, type Principal } from "@/lib/permissions";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts, renewalTiming } from "@/lib/compliance-expiry";
import { loadLienDeadlines } from "@/lib/lien-deadlines-query";
import { lienKindLabel } from "@/lib/lien-deadlines";
import { loadTodayDashboard } from "@/lib/today-dashboard";
import { estimateStage } from "@/lib/estimate-stage";
import { submittalState, type RevisionData } from "@/components/submittalLabels";
import { scheduledWorkerName } from "@/lib/crew-schedule-query";
import type { AreaSlug, Tone, ToolStatus, ToolStatuses } from "@/lib/areas";
import { overdueText } from "@/lib/due-date";
import { formatCalendarDay } from "@/lib/render-date";

/**
 * The live half of the areas (lib/areas.ts): one status line per tool, and
 * the combined "waiting" list on each area page.
 *
 * Every figure is a count or sum over existing rows, read the way the page
 * it links to reads it — RFIs "waiting" are SENT (lib/moneyRail.ts's
 * definition), a submittal is with the GC by `submittalState`, an order is
 * open until a delivery completes it (MaterialOrderDelivery's own rule),
 * renewals come from lib/compliance-expiry.ts. Nothing is stored or
 * invented, and a tool with no cheap real count gets NO status, so the
 * screen shows its plain description instead of a made-up number.
 *
 * Each read runs only for a viewer who can open the page it describes
 * (`canReach`), so no figure reaches a person the page would refuse.
 */


const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dollars = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

/** An order is open until a delivery says it completed the order. */
const OPEN_ORDER = { deliveries: { none: { completesOrder: true } } } as const;

async function submittalsByState(companyId: string, jobId?: string) {
  const rows = await prisma.submittal.findMany({
    where: { companyId, ...(jobId ? { jobId } : {}) },
    select: {
      id: true,
      number: true,
      title: true,
      jobId: true,
      job: { select: { name: true } },
      revisions: {
        select: {
          revisionNumber: true,
          sentOn: true,
          dueBack: true,
          returnedOn: true,
          outcome: true,
          responseNotes: true,
          responseUrl: true,
          responseFileName: true,
        },
      },
    },
  });
  return rows.map((row) => {
    const revisions: RevisionData[] = row.revisions.map((rev) => ({
      ...rev,
      sentOn: iso(rev.sentOn) as string,
      dueBack: iso(rev.dueBack),
      returnedOn: iso(rev.returnedOn),
    }));
    const latest = revisions.reduce<RevisionData | null>(
      (a, b) => (!a || b.revisionNumber > a.revisionNumber ? b : a),
      null,
    );
    return { ...row, state: submittalState(revisions), latest };
  });
}

/**
 * Status lines for every tool this viewer can open that has a cheap real
 * count. `known` lets a caller that already holds a figure (the home page
 * loads overdue invoices and today's crews for its own blocks) pass it in
 * rather than have it read twice.
 */
export async function loadToolStatuses(
  companyId: string,
  principal: Principal,
  todayIso: string,
  known: { overdue?: { total: number; count: number }; crewsOut?: number; inProgress?: number } = {},
  /** Read only these tools — an area page needs its own, not all six areas'. */
  only?: string[],
): Promise<ToolStatuses> {
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const readers: Record<string, () => Promise<ToolStatus | null>> = {
    "/dashboard": async () => {
      const n = known.inProgress ?? (await prisma.job.count({ where: { companyId, status: "IN_PROGRESS" } }));
      return { text: `${n} in progress` };
    },
    "/bids": async () => {
      const n = await prisma.bidInvitation.count({ where: { companyId, status: "INVITED", dueDate: { gte: today } } });
      return n === 0 ? { text: "No bids due" } : { text: plural(n, "bid") + " due", tone: "amber" };
    },
    "/pipeline": async () => {
      const n = await prisma.bidPursuit.count({ where: { companyId, stage: { not: "DROPPED" }, bidInvitationId: null } });
      return { text: `${n} being chased` };
    },
    "/contacts": async () => ({ text: plural(await prisma.contact.count({ where: { companyId } }), "contact") }),
    "/cash-flow": async () => {
      if (!known.overdue) return null;
      return known.overdue.count === 0
        ? { text: "No overdue invoices", tone: "green" }
        : { text: `${dollars(known.overdue.total)} overdue`, tone: "red" };
    },
    "/backcharges": async () => {
      const n = await prisma.backcharge.count({ where: { companyId, status: { in: ["RECEIVED", "DISPUTED"] } } });
      return { text: `${n} open`, tone: n > 0 ? "amber" : undefined };
    },
    "/lien-deadlines": async () => {
      const rows = await loadLienDeadlines(companyId, todayIso);
      const late = rows.filter((r) => r.state === "overdue").length;
      const soon = rows.filter((r) => r.state === "due_soon").length;
      if (late > 0) return { text: `${late} past due`, tone: "red" };
      return soon > 0 ? { text: `${soon} due soon`, tone: "amber" } : { text: "Nothing due soon" };
    },
    "/schedule": async () => {
      const n =
        known.crewsOut ??
        (await prisma.crewScheduleDay.findMany({ where: { companyId, workDate: today }, distinct: ["jobId"], select: { jobId: true } }))
          .length;
      return n === 0 ? { text: "No crews out today" } : { text: `${plural(n, "crew")} out today`, tone: "green" };
    },
    "/punch-lists": async () => {
      const n = await prisma.punchListItem.count({ where: { companyId, status: { not: "VERIFIED" } } });
      return { text: `${n} open`, tone: n > 0 ? "amber" : undefined };
    },
    "/rfis": async () => {
      const n = await prisma.rfi.count({ where: { companyId, status: "SENT" } });
      return n === 0 ? { text: "No RFIs waiting" } : { text: `${plural(n, "RFI")} waiting`, tone: "amber" };
    },
    "/submittals": async () => {
      const rows = await submittalsByState(companyId);
      const revise = rows.filter((r) => r.state === "REVISE").length;
      const withGc = rows.filter((r) => r.state === "WITH_GC").length;
      if (revise > 0) return { text: `${revise} to revise`, tone: "red" };
      return { text: `${withGc} with the GC`, tone: withGc > 0 ? "amber" : undefined };
    },
    "/drawings": async () => ({ text: plural(await prisma.drawingSet.count({ where: { companyId } }), "set") }),
    "/intake": async () => {
      const n = await prisma.documentIntake.count({ where: { companyId, status: "PROPOSED" } });
      return { text: `${n} to file`, tone: n > 0 ? "amber" : undefined };
    },
    "/compliance": async () => {
      const due = renewalAlerts(await renewalSourcesForCompany(companyId), todayIso).filter(
        (r) => r.urgency === "EXPIRED" || r.urgency === "DUE_SOON",
      );
      const expired = due.filter((r) => r.urgency === "EXPIRED").length;
      if (expired > 0) return { text: `${expired} expired`, tone: "red" };
      return due.length > 0 ? { text: `${due.length} expiring`, tone: "amber" } : { text: "All current", tone: "green" };
    },
    "/material-orders": async () => {
      const n = await prisma.materialOrder.count({ where: { companyId, ...OPEN_ORDER } });
      return { text: `${plural(n, "order")} open` };
    },
    "/vendors": async () => ({ text: plural(await prisma.vendor.count({ where: { companyId } }), "vendor") }),
  };

  const entries = await Promise.all(
    Object.entries(readers)
      .filter(([href]) => canReach(principal, href) && (!only || only.includes(href)))
      .map(async ([href, read]) => [href, await read()] as const),
  );
  const out: ToolStatuses = {};
  for (const [href, status] of entries) if (status) out[href] = status;
  return out;
}

/* ------------------------------------------------------------------ */

export type WaitingRow = {
  key: string;
  /** A short kind tag: RFI, SUB, INV… */
  tag: string;
  ref: string;
  subject: string;
  job: string | null;
  /** "11 days", "due in 3 days", "today". */
  when: string;
  status: { text: string; tone: Tone | "neutral" };
  href: string;
  action: string;
};

export type WaitingList = { title: string; rows: WaitingRow[]; total: number; empty: string };

const WAITING_SHOWN = 25;

/**
 * The one combined list on an area page — what in this area is waiting on
 * somebody, oldest or most urgent first — built from the same reads the
 * pages themselves make.
 */
export async function loadAreaWaiting(
  slug: AreaSlug,
  companyId: string,
  principal: Principal,
  todayIso: string,
): Promise<{ list: WaitingList; known: Parameters<typeof loadToolStatuses>[3] }> {
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const rows: WaitingRow[] = [];
  let known: Parameters<typeof loadToolStatuses>[3] = {};
  let title = "Waiting";
  let empty = "Nothing is waiting here.";

  switch (slug) {
    case "paperwork": {
      title = "Waiting on the GC";
      empty = "Nothing is out with the GC. Sent RFIs and submittals show up here until they come back.";
      const [rfis, submittals] = await Promise.all([
        canReach(principal, "/rfis")
          ? prisma.rfi.findMany({
              where: { companyId, status: "SENT" },
              select: { id: true, number: true, subject: true, jobId: true, sentOn: true, dueBy: true, job: { select: { name: true } } },
            })
          : [],
        canReach(principal, "/submittals") ? submittalsByState(companyId) : [],
      ]);
      const daysOut = new Map<string, number>();
      for (const rfi of rfis) {
        const sent = iso(rfi.sentOn);
        daysOut.set(`rfi-${rfi.id}`, sent ? daysBetween(sent, todayIso) : -1);
        const due = iso(rfi.dueBy);
        rows.push({
          key: `rfi-${rfi.id}`,
          tag: "RFI",
          ref: `RFI ${rfi.number}`,
          subject: rfi.subject,
          job: rfi.job.name,
          when: sent ? plural(Math.max(0, daysBetween(sent, todayIso)), "day") : "—",
          // Past due reads "Overdue N days" on the red chip, counted on the
          // viewer's calendar (todayIso is viewerToday()) — lib/due-date.ts.
          status:
            due && due < todayIso
              ? { text: overdueText(daysBetween(due, todayIso), true), tone: "red" }
              : { text: "Sent", tone: "neutral" },
          href: `/rfis?job=${encodeURIComponent(rfi.jobId)}`,
          action: "Open",
        });
      }
      for (const sub of submittals) {
        if (sub.state !== "WITH_GC" || !sub.latest) continue;
        const dueBack = sub.latest.dueBack;
        daysOut.set(`sub-${sub.id}`, daysBetween(sub.latest.sentOn, todayIso));
        rows.push({
          key: `sub-${sub.id}`,
          tag: "SUB",
          ref: `Submittal ${sub.number}`,
          subject: sub.title,
          job: sub.job.name,
          when: plural(Math.max(0, daysBetween(sub.latest.sentOn, todayIso)), "day"),
          status:
            dueBack && dueBack < todayIso
            ? { text: overdueText(daysBetween(dueBack, todayIso), true), tone: "red" }
            : { text: "With the GC", tone: "neutral" },
          href: `/submittals?job=${encodeURIComponent(sub.jobId)}`,
          action: "Open",
        });
      }
      // Longest out first — "11 days" before "1 day".
      rows.sort((a, b) => (daysOut.get(b.key) ?? 0) - (daysOut.get(a.key) ?? 0));
      break;
    }
    case "money": {
      title = "Overdue and coming due";
      empty = "Nothing is overdue and no lien deadline is close.";
      const [dash, liens] = await Promise.all([
        can(principal, "MANAGE_BILLING") ? loadTodayDashboard(companyId, today) : null,
        canReach(principal, "/lien-deadlines") ? loadLienDeadlines(companyId, todayIso) : [],
      ]);
      if (dash) {
        known = { overdue: { total: dash.overdueTotal, count: dash.overdue.length } };
        for (const inv of dash.overdue) {
          rows.push({
            key: `inv-${inv.id}`,
            tag: "INV",
            ref: `Invoice #${inv.number}`,
            subject: `${dollars(inv.outstanding)} from ${inv.gcName}`,
            job: inv.jobName,
            when: inv.dueOn ? `due ${formatCalendarDay(inv.dueOn, "dayMonth")}` : "—",
            status: { text: overdueText(inv.daysOverdue, true), tone: "red" },
            href: `/jobs/${inv.jobId}/billing`,
            action: "Chase",
          });
        }
      }
      for (const lien of liens) {
        if (lien.state !== "overdue" && lien.state !== "due_soon") continue;
        const days = lien.daysUntilDue ?? 0;
        rows.push({
          key: `lien-${lien.id}`,
          tag: "LIEN",
          ref: lienKindLabel(lien.kind, lien.otherLabel),
          subject: lien.recipient ? `To ${lien.recipient}` : "Not served yet",
          job: lien.jobName,
          when: days < 0 ? `due ${formatCalendarDay(lien.dueOn, "dayMonth")}` : days === 0 ? "due today" : `due in ${plural(days, "day")}`,
          status: lien.state === "overdue" ? { text: overdueText(Math.max(1, -days), true), tone: "red" } : { text: "Due soon", tone: "amber" },
          href: "/lien-deadlines",
          action: "Open",
        });
      }
      break;
    }
    case "crew-field": {
      title = "Today, and waiting on you";
      empty = "Nobody is on the schedule for today and no hours are waiting for approval.";
      const [schedule, signoffs] = await Promise.all([
        canReach(principal, "/schedule")
          ? prisma.crewScheduleDay.findMany({
              where: { companyId, workDate: today },
              select: {
                jobId: true,
                job: { select: { name: true } },
                scheduledUser: { select: { name: true, email: true } },
                crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
              },
              orderBy: { jobId: "asc" },
            })
          : [],
        // Same gate as the home page's "Approve hours" items.
        can(principal, "MANAGE_COMPLIANCE")
          ? prisma.timesheetSignoff.findMany({
              where: { companyId, approvedAt: null, reopenedAt: null },
              select: { id: true, date: true, jobId: true, job: { select: { name: true } } },
              orderBy: { date: "asc" },
              take: WAITING_SHOWN,
            })
          : [],
      ]);
      for (const s of signoffs) {
        const date = iso(s.date)!;
        rows.push({
          key: `hours-${s.id}`,
          tag: "HRS",
          ref: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }),
          subject: "Signed hours to approve",
          job: s.job.name,
          when: plural(Math.max(0, daysBetween(date, todayIso)), "day"),
          status: { text: "Needs approval", tone: "amber" },
          href: `/jobs/${s.jobId}/crew`,
          action: "Approve",
        });
      }
      const byJob = new Map<string, { name: string; people: string[] }>();
      for (const day of schedule) {
        const row = byJob.get(day.jobId) ?? { name: day.job.name, people: [] };
        row.people.push(scheduledWorkerName(day));
        byJob.set(day.jobId, row);
      }
      for (const [jobId, crew] of byJob) {
        rows.push({
          key: `crew-${jobId}`,
          tag: "CREW",
          ref: plural(crew.people.length, "person", "people"),
          subject: crew.people.join(", "),
          job: crew.name,
          when: "today",
          status: { text: "On site", tone: "green" },
          href: `/jobs/${jobId}/crew`,
          action: "Open",
        });
      }
      known = { crewsOut: byJob.size };
      break;
    }
    case "compliance-safety": {
      title = "Expired or expiring";
      empty = "Every certificate, licence, policy and bond on file is current.";
      if (canReach(principal, "/compliance")) {
        const due = renewalAlerts(await renewalSourcesForCompany(companyId), todayIso).filter(
          (r) => r.urgency === "EXPIRED" || r.urgency === "DUE_SOON",
        );
        for (const r of due) {
          rows.push({
            key: `doc-${r.kind}-${r.id}`,
            tag: "DOC",
            ref: r.title,
            subject: r.detail ?? "",
            job: null,
            when: renewalTiming(r),
            status: r.urgency === "EXPIRED" ? { text: "Expired", tone: "red" } : { text: "Renew soon", tone: "amber" },
            href: r.href,
            action: "Renew",
          });
        }
      }
      break;
    }
    case "materials-equipment": {
      title = "On order";
      empty = "Nothing is on order. Orders show up here until the delivery that completes them.";
      if (canReach(principal, "/material-orders")) {
        const orders = await prisma.materialOrder.findMany({
          where: { companyId, ...OPEN_ORDER },
          select: {
            id: true,
            number: true,
            description: true,
            jobId: true,
            orderedOn: true,
            promisedFor: true,
            job: { select: { name: true } },
            vendor: { select: { name: true } },
          },
          orderBy: { orderedOn: "asc" },
        });
        for (const o of orders) {
          const promised = iso(o.promisedFor);
          rows.push({
            key: `mo-${o.id}`,
            tag: "PO",
            ref: `Order ${o.number}`,
            subject: `${o.description} — ${o.vendor.name}`,
            job: o.job.name,
            when: plural(Math.max(0, daysBetween(iso(o.orderedOn)!, todayIso)), "day"),
            status:
              promised && promised < todayIso
              ? { text: overdueText(daysBetween(promised, todayIso), true), tone: "red" }
              : promised
                ? { text: `Promised ${formatCalendarDay(promised, "dayMonth")}`, tone: "neutral" }
                : { text: "No date promised", tone: "neutral" },
            href: `/material-orders?job=${encodeURIComponent(o.jobId)}`,
            action: "Open",
          });
        }
        rows.sort((a, b) => (a.status.tone === "red" ? 0 : 1) - (b.status.tone === "red" ? 0 : 1));
      }
      break;
    }
    case "jobs-bids": {
      title = "Bids due and estimates out";
      empty = "No bids are due and no estimate is waiting on a client.";
      const [bids, estimates] = await Promise.all([
        canReach(principal, "/bids")
          ? prisma.bidInvitation.findMany({
              where: { companyId, status: "INVITED", dueDate: { gte: today } },
              select: { id: true, projectName: true, dueDate: true, contact: { select: { name: true } } },
              orderBy: { dueDate: "asc" },
            })
          : [],
        can(principal, "MANAGE_ESTIMATING")
          ? prisma.job.findMany({
              where: { companyId, status: "ESTIMATE" },
              select: {
                id: true,
                name: true,
                contact: { select: { name: true } },
                _count: { select: { lineItems: { where: { isDeleted: false } } } },
                signatureRequests: { select: { status: true } },
              },
            })
          : [],
      ]);
      for (const bid of bids) {
        const days = daysBetween(todayIso, iso(bid.dueDate)!);
        rows.push({
          key: `bid-${bid.id}`,
          tag: "BID",
          ref: bid.contact.name,
          subject: bid.projectName,
          job: null,
          when: days === 0 ? "due today" : `due in ${plural(days, "day")}`,
          status: days <= 3 ? { text: "Due soon", tone: "amber" } : { text: "Invited", tone: "neutral" },
          // The bid's own page — same MANAGE_ESTIMATING gate as /bids above.
          href: `/ai/bids/${bid.id}`,
          action: "Open",
        });
      }
      for (const job of estimates) {
        const stage = estimateStage(job._count.lineItems, job.signatureRequests.map((r) => r.status));
        if (stage.key !== "READY_TO_SEND" && stage.key !== "OUT_FOR_SIGNATURE") continue;
        rows.push({
          key: `est-${job.id}`,
          tag: "EST",
          ref: job.contact.name,
          subject: job.name,
          job: null,
          when: "",
          status: { text: stage.label, tone: stage.key === "READY_TO_SEND" ? "amber" : "neutral" },
          href: `/jobs/${job.id}/proposal`,
          action: stage.key === "READY_TO_SEND" ? "Send" : "Check",
        });
      }
      break;
    }
  }

  return { list: { title, rows: rows.slice(0, WAITING_SHOWN), total: rows.length, empty }, known };
}
