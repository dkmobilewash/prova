import Link from "next/link";
import { cookies } from "next/headers";
import { Card, PageShell, StatusBadge } from "@prova/ui";
import { JobStatus, Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { redirectToOnboardingIfUnasked } from "@/lib/onboarding-gate";
import { estimateStage } from "@/lib/estimate-stage";
import { can, canReach } from "@/lib/permissions";
import { money } from "@/lib/money";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts, renewalTiming } from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";
import { viewerTimeZone } from "@/lib/viewerToday";
import { todayInZone } from "@/lib/viewer-timezone";
import { loadTodayDashboard } from "@/lib/today-dashboard";
import { EmptyState } from "@/components/EmptyState";
import { GettingStartedCard } from "@/components/GettingStartedCard";
import { FullTourOffer } from "@/components/FullTourOffer";
import { tradeScopeLabel } from "@/components/tradeScopeLabels";
import { SearchTrigger } from "@/components/shell/SearchTrigger";
import {
  CrewsBlock,
  HomeSearch,
  JobCard,
  MoneyBlock,
  NeedsBlock,
  PhoneTiles,
  ShortcutChips,
  type JobCardData,
  type NeedItem,
  type Shortcut,
} from "@/components/home/HomeParts";
import { greeting, hourIn, jobStage, nextAction, type ActionRights } from "@/components/home/home-logic";
import { gettingStartedChecklist } from "@/lib/getting-started";
import { loadGettingStartedCounts } from "@/lib/getting-started-counts";
import { GETTING_STARTED_HIDDEN_COOKIE, isGettingStartedHidden } from "@/lib/getting-started-cookie";
import {
  ReceivablesDetailPanel,
  ReceivablesList,
  ReceivablesProvider,
} from "@/components/ReceivablesPanel";
import { loadHomeExtras } from "./home-data";

/**
 * Home (Concept G, 2026-10-10).
 *
 * A greeting with the day's real counts, the big search box with four
 * shortcuts, then three blocks — Needs you today, Money, Crews today — and
 * the jobs as cards, each with its stage and the ONE thing to do next. On a
 * phone the four field actions come first, as big tiles.
 *
 * Every number is derived on read — from Invoice, Payment, CostEntry,
 * JobLineItem, Rfi, TimesheetSignoff and CrewScheduleDay, through
 * lib/today-dashboard.ts and ./home-data.ts. Nothing here is stored or
 * cached, per ARCHITECTURE.md, and a block with nothing to say says so
 * rather than showing a made-up figure.
 *
 * The searchable, filterable list of every job is still here, at the
 * bottom (#all-jobs). #jobs is the Your jobs cards, where the top bar's
 * Jobs link and the phone's Jobs tab land; /jobs and /estimating redirect here.
 */

const STATUS_FILTERS: { value: JobStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ESTIMATE", label: "Estimating" },
  { value: "CONTRACTED", label: "Contracted" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETE", label: "Complete" },
];

const ALL_STATUSES: JobStatus[] = ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"];

const GROUP_HEADING: Record<JobStatus, string> = {
  ESTIMATE: "Estimating",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

const STAGE_TONE: Record<string, string> = {
  NEEDS_PRICING: "border-line-card bg-tag-slate text-tag-slate-ink",
  READY_TO_SEND: "border-transparent bg-tag-brand text-tag-brand-ink",
  OUT_FOR_SIGNATURE: "border-transparent bg-tag-amber text-tag-amber-ink",
  SIGNED: "border-transparent bg-tag-green text-tag-green-ink",
};

/** Whole literals so Tailwind sees every class. */
const BLOCK_GRID = {
  three: "mt-[26px] grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr_1fr]",
  two: "mt-[26px] grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]",
};

/** How many job cards the home shows before "All N jobs". */
const CARDS_SHOWN = 6;

type JobRow = Awaited<ReturnType<typeof loadJobs>>[number];

async function loadJobs(companyId: string, where: Prisma.JobWhereInput) {
  return prisma.job.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      contact: true,
      lineItems: { where: { isDeleted: false } },
      signatureRequests: { select: { status: true } },
      invoices: { select: { amount: true } },
    },
  });
}

function jobValue(job: JobRow) {
  return job.lineItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice ?? 0),
    0,
  );
}

function filterHref(status: JobStatus | "ALL", q?: string) {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (q) params.set("q", q);
  const query = params.toString();
  // #all-jobs: a filter is clicked at the full jobs list, so it lands back there
  // rather than at the top of the page.
  return query ? `/dashboard?${query}#all-jobs` : "/dashboard#all-jobs";
}

function dayLabel(iso: string, style: "long" | "short") {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: style,
    month: style,
    day: "numeric",
  });
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One job to send a shortcut to, or the palette when there is a choice. */
function pickJob(label: string, jobs: { id: string; name: string }[], path: string, query: string): Shortcut | null {
  if (jobs.length === 0) return null;
  if (jobs.length === 1) return { label, href: `/jobs/${jobs[0]!.id}/${path}`, sub: jobs[0]!.name };
  return { label, query, sub: "Pick the job" };
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();

  // The onboarding gate. THIS MUST STAY THE FIRST THING AFTER
  // requireCompanyContext() — redirect() throws, so nothing below it runs
  // when it fires, and this is the one page a fresh signup or sign-in ever
  // lands on by default (see lib/onboarding-gate.ts's own header for why
  // that makes this the only page that should ever call it).
  redirectToOnboardingIfUnasked({ role: currentUser.role, businessScopeAskedAt: company.businessScopeAskedAt });

  // Both TRUE for an owner and for a member with no job function set. A
  // narrowed function loses the money and keeps the work.
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };
  const showsBilling = can(principal, "MANAGE_BILLING");
  const showsJobMoney = can(principal, "VIEW_JOB_COSTS");
  const rights: ActionRights = {
    billing: showsBilling,
    field: can(principal, "MANAGE_FIELD"),
    jobs: can(principal, "MANAGE_JOBS"),
    estimating: can(principal, "MANAGE_ESTIMATING"),
  };
  const { q, status } = await searchParams;

  const activeStatus = ALL_STATUSES.includes(status as JobStatus) ? (status as JobStatus) : null;

  const where: Prisma.JobWhereInput = { companyId: company.id };
  if (activeStatus) where.status = activeStatus;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  // The READER'S calendar day and clock — what "overdue", "today's crew"
  // and "good morning" are all claims about. See lib/viewerToday.ts.
  const timeZone = await viewerTimeZone();
  const todayIso = todayInZone(timeZone);
  const asOf = new Date(`${todayIso}T00:00:00.000Z`);

  // The getting-started card. Hidden-by-cookie is decided HERE, on the
  // server, from the request — so the markup the browser hydrates already
  // either has the card or does not. Once hidden, the counts are not asked.
  const cookieStore = await cookies();
  const gettingStartedHidden = isGettingStartedHidden(
    cookieStore.get(GETTING_STARTED_HIDDEN_COOKIE)?.value,
    company.id,
  );

  const [jobs, allJobs, renewalSources, today, gettingStartedCounts, extras] = await Promise.all([
    loadJobs(company.id, where),
    loadJobs(company.id, { companyId: company.id }),
    renewalSourcesForCompany(company.id),
    loadTodayDashboard(company.id, asOf),
    gettingStartedHidden ? null : loadGettingStartedCounts(company.id),
    loadHomeExtras(company.id, todayIso, {
      rfis: rights.jobs,
      signoffs: can(principal, "MANAGE_COMPLIANCE"),
      money: showsBilling,
    }),
  ]);

  const gettingStarted = gettingStartedCounts
    ? gettingStartedChecklist({ companyName: company.name, counts: gettingStartedCounts, viewer: principal })
    : null;

  const renewals = renewalAlerts(renewalSources, serverToday());
  const expiringSoon = renewals.filter(
    (renewal) => renewal.urgency === "EXPIRED" || renewal.urgency === "DUE_SOON",
  );

  const estimating = allJobs.filter((job) => job.status === "ESTIMATE");
  const pipelineValue = estimating.reduce((sum, job) => sum + jobValue(job), 0);
  const inProgress = allJobs.filter((job) => job.status === "IN_PROGRESS");

  // A company with no jobs has nothing for most of this page to say — no
  // invoice, cost, crew day or GC exists without a job to hang it on — so it
  // gets the checklist (or the jobs empty state once that is hidden), and
  // every block returns the moment the first job exists. The ONE
  // company-level thing that can exist before a job is a licence running
  // out, so that card still shows when it has something in it.
  const isNewAccount = allJobs.length === 0;
  // While the checklist shows on a brand-new account it is the ONE start:
  // its first step is "start your first job" and it links Ask, so the
  // search box, the empty state and the tour offer would be the same door.
  const checklistShowing = gettingStarted !== null && !gettingStarted.complete;
  const onlyChecklist = isNewAccount && checklistShowing;

  // Only doors this viewer can open.
  const overdueHref = canReach(principal, "/cash-flow") ? "/cash-flow#aging" : undefined;
  const retainageHref = canReach(principal, "/cash-flow") ? "/cash-flow#retainage" : undefined;
  const complianceHref = canReach(principal, "/compliance") ? "/compliance" : undefined;

  /* -------------------------------------------- needs you today ---- */
  // Red before amber; inside each, the order each source already sorts by.
  const needs: NeedItem[] = [];
  if (showsBilling) {
    for (const inv of today.overdue) {
      needs.push({
        key: `inv-${inv.id}`,
        tone: "red",
        text: `Invoice #${inv.number} to ${inv.gcName} — ${inv.jobName}`,
        when: `${plural(inv.daysOverdue, "day")} late`,
        action: { label: "Chase", href: `/jobs/${inv.jobId}/billing` },
      });
    }
  }
  for (const renewal of expiringSoon) {
    needs.push({
      key: `doc-${renewal.kind}-${renewal.id}`,
      tone: renewal.urgency === "EXPIRED" ? "red" : "amber",
      text: renewal.detail ? `${renewal.title} — ${renewal.detail}` : renewal.title,
      when: renewalTiming(renewal),
      action: complianceHref ? { label: "Renew", href: complianceHref } : undefined,
    });
  }
  for (const rfi of extras.overdueRfis) {
    needs.push({
      key: `rfi-${rfi.id}`,
      tone: "amber",
      text: `RFI ${rfi.number} answer is late — ${rfi.jobName}`,
      when: plural(rfi.daysLate, "day"),
      action: { label: "Chase", href: `/rfis?job=${rfi.jobId}` },
    });
  }
  for (const day of extras.unapprovedDays) {
    needs.push({
      key: `hours-${day.id}`,
      tone: "amber",
      text: `Approve hours for ${dayLabel(day.date, "short")} — ${day.jobName}`,
      when: "Signed",
      action: { label: "Approve", href: `/jobs/${day.jobId}/crew` },
    });
  }
  if (showsJobMoney) {
    for (const row of today.jobHealth.filter((r) => r.tone === "over")) {
      needs.push({
        key: `budget-${row.jobId}`,
        tone: "amber",
        text: `${row.name} is forecast over budget`,
        when: "",
        action: { label: "Review", href: canReach(principal, "/wip") ? "/wip" : `/jobs/${row.jobId}` },
      });
    }
  }
  needs.sort((a, b) => (a.tone === "red" ? 0 : 1) - (b.tone === "red" ? 0 : 1));

  /* ------------------------------------------------------ job cards -- */
  const overdueByJob = new Map<string, { number: number; daysOverdue: number }>();
  for (const inv of today.overdue) if (!overdueByJob.has(inv.jobId)) overdueByJob.set(inv.jobId, inv);
  const rfisByJob = new Map<string, { number: number; count: number }>();
  for (const rfi of extras.overdueRfis) {
    const seen = rfisByJob.get(rfi.jobId);
    rfisByJob.set(rfi.jobId, { number: seen?.number ?? rfi.number, count: (seen?.count ?? 0) + 1 });
  }
  const crewByJob = new Map(extras.crewsToday.map((c) => [c.jobId, c.people.length]));
  const healthByJob = new Map(today.jobHealth.map((r) => [r.jobId, r]));

  const STATUS_ORDER: Record<JobStatus, number> = { IN_PROGRESS: 0, CONTRACTED: 1, ESTIMATE: 2, COMPLETE: 3 };
  const open = allJobs.filter((job) => job.status !== "COMPLETE");
  const cards: JobCardData[] = (open.length > 0 ? open : allJobs)
    .map((job) => {
      const est =
        job.status === "ESTIMATE"
          ? estimateStage(job.lineItems.length, job.signatureRequests.map((r) => r.status)).key
          : null;
      const overdueInvoice = showsBilling ? overdueByJob.get(job.id) ?? null : null;
      const rfi = rights.jobs ? rfisByJob.get(job.id) ?? null : null;
      const action = nextAction({
        jobId: job.id,
        status: job.status,
        estimateStage: est,
        invoiceCount: job.invoices.length,
        overdueInvoice,
        overdueRfi: rfi,
        scheduledToday: crewByJob.get(job.id) ?? 0,
        rights,
      });
      const value = jobValue(job);
      const billed = job.invoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
      const trades = [...new Set(job.lineItems.map((l) => tradeScopeLabel(l.tradeScope)).filter(Boolean))];
      const line = [
        job.contact.name,
        trades.length === 1 ? trades[0] : trades.length > 1 ? `${trades.length} trades` : null,
        showsJobMoney && value > 0 ? `${Math.round((billed / value) * 100)}% billed` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const health = showsJobMoney ? healthByJob.get(job.id) : undefined;
      return {
        sort: (action.primary ? 0 : 10) + STATUS_ORDER[job.status],
        card: {
          id: job.id,
          name: job.name,
          line,
          stage: jobStage({ status: job.status, estimateStage: est, invoiceCount: job.invoices.length }),
          tag: overdueInvoice
            ? { text: "Invoice late", tone: "rose" as const }
            : rfi
              ? { text: `${rfi.count} RFI late`, tone: "amber" as const }
              : undefined,
          health:
            health && (health.tone === "over" || health.tone === "watch")
              ? { sentence: health.sentence, tone: health.tone }
              : undefined,
          action,
        } satisfies JobCardData,
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .slice(0, CARDS_SHOWN)
    .map((entry) => entry.card);

  /* ------------------------------------------------------ shortcuts -- */
  const crewedToday = extras.crewsToday.map((c) => ({ id: c.jobId, name: c.jobName }));
  const logHours = rights.field
    ? pickJob("Log hours", crewedToday.length > 0 ? crewedToday : inProgress, "crew", "log hours")
    : null;
  const sendPayApp = showsBilling ? pickJob("Send pay app", inProgress, "billing", "pay app") : null;
  const rfisReachable = canReach(principal, "/rfis");
  const chips = [
    ...(logHours ? [{ icon: "◷", shortcut: logHours }] : []),
    ...(sendPayApp ? [{ icon: "↗", shortcut: sendPayApp }] : []),
    ...(rfisReachable ? [{ icon: "?", shortcut: { label: "Find an RFI", href: "/rfis" } }] : []),
  ];
  const tiles = [
    ...(canReach(principal, "/photos") ? [{ icon: "camera", shortcut: { label: "Take a photo", href: "/photos" } }] : []),
    ...(rfisReachable ? [{ icon: "rfi", shortcut: { label: "New RFI", href: "/rfis" } }] : []),
    ...(canReach(principal, "/field-reports")
      ? [{ icon: "report", shortcut: { label: "Daily report", href: "/field-reports" } }]
      : []),
  ];

  /* ------------------------------------------------------- greeting -- */
  const firstName = currentUser.name?.trim().split(/\s+/)[0];
  const hello = `${greeting(hourIn(timeZone))}${firstName ? `, ${firstName}` : ""}`;
  const crewsOut = extras.crewsToday.length;
  const dateLine = [
    dayLabel(todayIso, "long"),
    crewsOut > 0 ? `${plural(crewsOut, "crew")} out` : null,
    isNewAccount ? null : `${plural(inProgress.length, "job")} in progress`,
  ]
    .filter(Boolean)
    .join(" · ");

  const complianceCard = (
    <Card>
      <h3 className="text-sm font-semibold text-ink">Compliance</h3>
      <ul className="mt-3 divide-y divide-line-row">
        {expiringSoon.slice(0, 6).map((renewal) => (
          <li key={`${renewal.kind}-${renewal.id}`} className="py-2.5">
            <p className="text-sm font-medium text-ink">
              {renewal.title}
              {renewal.detail && <span className="font-normal text-ink-body"> — {renewal.detail}</span>}
            </p>
            <p className={`text-xs ${renewal.urgency === "EXPIRED" ? "text-tag-rose-ink" : "text-tag-amber-ink"}`}>
              {renewalTiming(renewal)}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );

  const grouped = activeStatus
    ? [{ status: activeStatus, rows: jobs }]
    : ALL_STATUSES.map((s) => ({ status: s, rows: jobs.filter((job) => job.status === s) })).filter(
        (group) => group.rows.length > 0,
      );

  return (
    // The rows, not the markup. This is a client provider, so anything
    // handed to it reaches the browser whether or not a list renders it —
    // gated like the list itself, so a count of this company's invoices
    // reaches the browser only for a viewer who can see billing.
    <ReceivablesProvider
      rows={showsBilling ? today.receivables : []}
      invoicesRaised={showsBilling ? today.invoicesRaised : 0}
    >
      {/* The panel is a sibling of this column, not a child of it — that is
          what lets it push rather than cover. */}
      <div className="flex min-h-full bg-canvas">
        <div className="min-w-0 flex-1">
          <PageShell width="working">
            {/* ------------------------------------------------- hero -- */}
            <div className="md:pt-2 md:text-center" data-home="greeting">
              <h1 className="font-headline text-[38px] font-semibold leading-none text-ink md:text-4xl md:leading-tight">
                {hello}
              </h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">{dateLine}</p>
            </div>

            {!onlyChecklist && (
              <HomeSearch>
                <SearchTrigger size="lg" />
                <ShortcutChips newJob={!isNewAccount} others={isNewAccount ? [] : chips} />
              </HomeSearch>
            )}

            {!isNewAccount && (
              <PhoneTiles
                primary={logHours ? { ...logHours, label: "Log today's hours" } : null}
                tiles={tiles}
              />
            )}

            {/* The full tour, offered once to a brand-new account — but not
                while the checklist is the one start on screen. */}
            {isNewAccount && !onlyChecklist && <FullTourOffer />}

            {/* A brand-new company that has hidden the checklist still gets
                the one thing it can do. The example rows are static markup,
                labelled as an example by EmptyState itself — never data. */}
            {isNewAccount && !onlyChecklist && (
              <EmptyState
                data-tour="dashboard-jobs-empty"
                className="mt-6"
                title="No jobs yet"
                purpose={
                  <p>
                    Everything in C Stream hangs off a job: the estimate, the crew&rsquo;s hours, the
                    invoices, the paperwork. Start your first one and this page fills in with what
                    needs you, who is on site today and where the money stands.
                  </p>
                }
                actions={[
                  { label: "Start your first job", href: "/jobs/new" },
                  { label: "Bring jobs in from a spreadsheet", href: "/settings/import" },
                ]}
                example={{
                  caption: "What your jobs list looks like once it is in use. Not your data — nothing here is saved.",
                  rows: [
                    {
                      title: "Oak Ave Medical — level 3 framing and drywall",
                      tag: "In progress",
                      detail: "Example General Contractor",
                      meta: showsJobMoney ? "$412,000" : undefined,
                    },
                    {
                      title: "Lincoln HS gym — acoustical ceilings",
                      tag: "Estimating",
                      detail: "Sample Builders · Needs pricing",
                      meta: showsJobMoney ? "$186,500" : undefined,
                    },
                    {
                      title: "Harbor View Lofts — EIFS",
                      tag: "Contracted",
                      detail: "Example General Contractor",
                      meta: showsJobMoney ? "$95,200" : undefined,
                    },
                  ],
                }}
              />
            )}

            {gettingStarted && checklistShowing && (
              <div className="mt-6" data-tour="dashboard-getting-started">
                <GettingStartedCard checklist={gettingStarted} />
              </div>
            )}

            {/* Before the first job, the one block with something to say. */}
            {isNewAccount && expiringSoon.length > 0 && <div className="mt-6">{complianceCard}</div>}

            {/* ----------------------------------------- three blocks -- */}
            {!isNewAccount && (
              <div className={showsBilling ? BLOCK_GRID.three : BLOCK_GRID.two}>
                <NeedsBlock items={needs} />
                {showsBilling && (
                  <MoneyBlock
                    figures={{
                      month: new Date(`${todayIso}T00:00:00.000Z`).toLocaleDateString("en-US", {
                        timeZone: "UTC",
                        month: "long",
                      }),
                      billed: extras.billedThisMonth,
                      collected: extras.collectedThisMonth,
                      retainage: today.retainageHeld,
                      overdue: today.overdueTotal,
                      overdueCount: today.overdue.length,
                      outstanding: today.receivables.reduce((sum, r) => sum + r.outstanding, 0),
                      overdueHref,
                      retainageHref,
                    }}
                  />
                )}
                <CrewsBlock crews={extras.crewsToday} />
              </div>
            )}

            {/* ------------------------------------------- your jobs -- */}
            {!isNewAccount && (
              <section id="jobs" className="mt-[26px] scroll-mt-20" data-tour="dashboard-job-health">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-headline text-[22px] font-semibold text-ink">Your jobs</h2>
                  <a href="#all-jobs" className="text-sm text-ink-muted hover:text-ink">
                    All {allJobs.length} {allJobs.length === 1 ? "job" : "jobs"} &rarr;
                  </a>
                </div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card) => (
                    <JobCard key={card.id} job={card} />
                  ))}
                </div>
              </section>
            )}

            {/* ------------------------------------- who owes you -- */}
            {/* The detail behind the Money block: every open invoice, and
                how each GC has paid. */}
            {showsBilling && !isNewAccount && (
              <section className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card>
                  <h3 className="text-sm font-semibold text-ink">Accounts receivable</h3>
                  <p className="mb-2 text-xs text-ink-body">
                    Outstanding invoices, longest overdue first. Open one for the detail.
                  </p>
                  <ReceivablesList />
                </Card>

                <Card>
                  <h3 className="text-sm font-semibold text-ink">How your GCs pay</h3>
                  {today.gcReliability.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-body">
                      No invoices raised yet, so there is nothing to judge.{" "}
                      <a href="#all-jobs" className="text-link hover:underline">
                        Open a job below
                      </a>{" "}
                      and use its Billing tab — this fills in once a GC has paid one.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-line-row">
                      {today.gcReliability.slice(0, 6).map((row) => (
                        <li key={row.contactId} className="flex items-baseline justify-between gap-3 py-2.5">
                          <Link href={`/contacts/${row.contactId}`} className="min-w-0">
                            {/* NOT `truncate`: the GC's name is the only thing
                                telling these rows apart, and at 375px two
                                regions of one GC would clip to the same row. */}
                            <span className="block break-words text-sm font-medium text-ink">{row.name}</span>
                            <span className="block text-xs text-ink-body">
                              {row.reliability.averageDaysToPay === null
                                ? "Nothing paid in full yet"
                                : `Pays in ${Math.round(row.reliability.averageDaysToPay)} days on average`}
                            </span>
                          </Link>
                          <span className="shrink-0 text-right">
                            {row.reliability.onTimeRate === null ? (
                              <span className="block max-w-[7.5rem] text-xs text-ink-body">
                                Not enough paid yet to say
                              </span>
                            ) : (
                              <>
                                <span className="block text-sm font-medium tabular-nums text-ink">
                                  {`${Math.round(row.reliability.onTimeRate * 100)}%`}
                                </span>
                                <span className="block text-xs text-ink-body">on time</span>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            )}

            {/* --------------------------------------- browse all jobs - */}
            {/* A new account's jobs empty state is at the top of the page. */}
            {!isNewAccount && (
              <section id="all-jobs" className="mt-10 scroll-mt-20 border-t border-line-card pt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-headline text-[22px] font-semibold text-ink">Browse all jobs</h2>
                  <p className="text-xs text-ink-body">
                    {showsJobMoney
                      ? `${money(pipelineValue)} still being priced across ${estimating.length} ${estimating.length === 1 ? "estimate" : "estimates"}`
                      : `${estimating.length} ${estimating.length === 1 ? "estimate" : "estimates"} still being priced`}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href="/jobs/new"
                    className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
                  >
                    New job
                  </Link>
                  <form action="#all-jobs" className="flex flex-wrap items-center gap-2">
                    {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
                    <input
                      type="search"
                      name="q"
                      defaultValue={q}
                      placeholder="Search job or client"
                      aria-label="Search jobs by job or client name"
                      className="w-52 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-line-card bg-surface px-3 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
                    >
                      Search
                    </button>
                  </form>
                  <Link href="/catalog" className="text-sm text-link hover:underline">
                    Line item catalog
                  </Link>
                  <Link href="/bids" className="text-sm text-link hover:underline">
                    Bid history
                  </Link>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-b border-line-card pb-4" data-tour="dashboard-job-filters">
                  {STATUS_FILTERS.map((filter) => {
                    const isActive =
                      filter.value === "ALL" ? activeStatus === null : activeStatus === filter.value;
                    return (
                      <Link
                        key={filter.value}
                        href={filterHref(filter.value, q)}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          isActive
                            ? "border-brand bg-tag-brand text-tag-brand-ink"
                            : "border-line-card bg-surface text-ink-body hover:text-ink"
                        }`}
                      >
                        {filter.label}
                      </Link>
                    );
                  })}
                </div>

                {jobs.length === 0 ? (
                  <Card className="mt-6 text-sm text-ink-body">
                    {q ? (
                      <>
                        Nothing matches “{q}”
                        {activeStatus ? ` in ${GROUP_HEADING[activeStatus].toLowerCase()}` : ""}.{" "}
                        <Link href={filterHref(activeStatus ?? "ALL")} className="text-link hover:underline">
                          Clear the search
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        Nothing {GROUP_HEADING[activeStatus as JobStatus].toLowerCase() === "estimating" ? "being estimated" : `marked ${GROUP_HEADING[activeStatus as JobStatus].toLowerCase()}`} right now.{" "}
                        <Link href={filterHref("ALL", q)} className="text-link hover:underline">
                          Show all jobs
                        </Link>
                        .
                      </>
                    )}
                  </Card>
                ) : (
                  <div className="mt-6 flex flex-col gap-6" data-tour="dashboard-job-list">
                    {grouped.map((group) => (
                      <div key={group.status}>
                        {!activeStatus && (
                          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-label">
                            {GROUP_HEADING[group.status]} · {group.rows.length}
                          </h3>
                        )}
                        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                          {group.rows.map((job) => {
                            const stage =
                              job.status === "ESTIMATE"
                                ? estimateStage(
                                    job.lineItems.length,
                                    job.signatureRequests.map((request) => request.status),
                                  )
                                : null;
                            return (
                              <li key={job.id} className="p-4">
                                <Link href={`/jobs/${job.id}`} className="block">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium text-ink">{job.name}</p>
                                      <StatusBadge status={job.status} />
                                      {stage && (
                                        <span className={`rounded-full border px-2 py-0.5 text-xs ${STAGE_TONE[stage.key]}`}>
                                          {stage.label}
                                        </span>
                                      )}
                                    </div>
                                    {showsJobMoney && (
                                      <p className="text-sm font-medium tabular-nums text-ink">{money(jobValue(job))}</p>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-sm text-ink-body">{job.contact.name}</p>
                                  {stage && <p className="mt-1 text-xs text-ink-body">{stage.detail}</p>}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </PageShell>
        </div>

        <ReceivablesDetailPanel />
      </div>
    </ReceivablesProvider>
  );
}
