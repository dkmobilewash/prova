import Link from "next/link";
import { cookies } from "next/headers";
import { Card, PageShell } from "@prova/ui";
import type { JobStatus } from "@prova/db";
import { jobValue, loadJobs } from "@/lib/jobs-list";
import { requireCompanyContext } from "@/lib/auth";
import { redirectToOnboardingIfUnasked } from "@/lib/onboarding-gate";
import { estimateStage } from "@/lib/estimate-stage";
import { can, canReach } from "@/lib/permissions";
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
import { AreaBoxes } from "@/components/areas/AreaBoxes";
import { areaViews, areasFor } from "@/lib/areas";
import { loadToolStatuses } from "@/lib/areas-data";
import {
  CrewsBlock,
  JobCard,
  MoneyBlock,
  NeedsBlock,
  PhoneTiles,
  RunningCard,
  ShortcutChips,
  type JobCardData,
  type NeedItem,
  type Shortcut,
} from "@/components/home/HomeParts";
import { greeting, hourIn, jobStage, nextAction, type ActionRights } from "@/components/home/home-logic";
import { billingNoun } from "@/components/job/jobStages";
import { gettingStartedChecklist } from "@/lib/getting-started";
import { loadGettingStartedCounts } from "@/lib/getting-started-counts";
import { GETTING_STARTED_HIDDEN_COOKIE, isGettingStartedHidden } from "@/lib/getting-started-cookie";
import {
  ReceivablesDetailPanel,
  ReceivablesList,
  ReceivablesProvider,
} from "@/components/ReceivablesPanel";
import { loadHomeExtras } from "./home-data";
import { overdueText } from "@/lib/due-date";
import { EMPTY_TASKS, loadTaskList } from "@/lib/agents/tasks";

/**
 * Home (Concept G, 2026-10-10; Concept H the same day).
 *
 * A greeting with the day's real counts and the shortcuts beside it (the
 * search box made compact: the top bar's search is on every page), the six
 * AREA boxes — every page in the app, filed where a sub would look for it,
 * each with one live line (lib/areas.ts, lib/areas-data.ts) — then three
 * blocks (Needs you today, Money, Crews today) and the jobs as cards, each
 * with its stage and the ONE thing to do next. On a phone the areas are
 * two-column tiles straight to each area page, then "Log today's hours".
 *
 * Every number is derived on read — from Invoice, Payment, CostEntry,
 * JobLineItem, Rfi, TimesheetSignoff and CrewScheduleDay, through
 * lib/today-dashboard.ts and ./home-data.ts. Nothing here is stored or
 * cached, per ARCHITECTURE.md, and a block with nothing to say says so
 * rather than showing a made-up figure.
 *
 * The searchable, filterable list of every job is /jobs (it sat at the
 * bottom of this page until 2026-10-11); "All N jobs" under the cards and the
 * top bar's Jobs both go there.
 */

/** Whole literals so Tailwind sees every class. 20/16px since the compact
 * pass (2026-10-11), from 26/20. */
const BLOCK_GRID = {
  three: "mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr_1fr]",
  two: "mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]",
};

/** How many job cards the home shows before "All N jobs". */
const CARDS_SHOWN = 6;

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

export default async function TodayPage() {
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
  const bill = billingNoun(company.filesMonthlyPayApps);
  const showsJobMoney = can(principal, "VIEW_JOB_COSTS");
  const rights: ActionRights = {
    billing: showsBilling,
    field: can(principal, "MANAGE_FIELD"),
    jobs: can(principal, "MANAGE_JOBS"),
    estimating: can(principal, "MANAGE_ESTIMATING"),
  };
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

  const [allJobs, renewalSources, today, gettingStartedCounts, extras, tasks] = await Promise.all([
    loadJobs({ companyId: company.id }),
    renewalSourcesForCompany(company.id),
    loadTodayDashboard(company.id, asOf),
    gettingStartedHidden ? null : loadGettingStartedCounts(company.id),
    loadHomeExtras(company.id, todayIso, {
      rfis: rights.jobs,
      signoffs: can(principal, "MANAGE_COMPLIANCE"),
      money: showsBilling,
    }),
    // The Running now card: the agents' runs, behind the /ai gate. A failed
    // read costs the card, never the home page.
    rights.estimating
      ? loadTaskList(company.id).catch((error: unknown) => {
          console.error("[home] agent runs failed to load; the card is hidden.", error);
          return EMPTY_TASKS;
        })
      : EMPTY_TASKS,
  ]);

  const gettingStarted = gettingStartedCounts
    ? gettingStartedChecklist({ companyName: company.name, counts: gettingStartedCounts, viewer: principal })
    : null;

  const renewals = renewalAlerts(renewalSources, serverToday());
  const expiringSoon = renewals.filter(
    (renewal) => renewal.urgency === "EXPIRED" || renewal.urgency === "DUE_SOON",
  );

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
        text: `${bill.one} #${inv.number} to ${inv.gcName} — ${inv.jobName}`,
        when: overdueText(inv.daysOverdue),
        whenTone: "danger",
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
      // Lapsed is past due, and reads like an overdue invoice: red, not grey
      // beside a red dot (click test, 2026-10-11).
      ...(renewal.urgency === "EXPIRED" ? { whenTone: "danger" as const } : {}),
      action: complianceHref ? { label: "Renew", href: complianceHref } : undefined,
    });
  }
  for (const rfi of extras.overdueRfis) {
    needs.push({
      key: `rfi-${rfi.id}`,
      tone: "amber",
      text: `RFI ${rfi.number} answer is late — ${rfi.jobName}`,
      when: overdueText(rfi.daysLate),
      whenTone: "danger",
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
        billNoun: bill.lower,
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
            ? { text: overdueText(overdueInvoice.daysOverdue, true), tone: "rose" as const }
            : rfi
              ? { text: `${rfi.count} ${rfi.count === 1 ? "RFI" : "RFIs"} late`, tone: "amber" as const }
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
  const sendPayApp = showsBilling ? pickJob(`Send ${bill.lower}`, inProgress, "billing", "pay app") : null;
  const rfisReachable = canReach(principal, "/rfis");
  // The field creates (Concept G's phone tiles, restored 2026-10-11): each
  // lands on its form already open. With one job to choose it rides along;
  // with more, the form's own job select (RFI, daily report) or the
  // palette's job picker (a photo needs a job before anything) asks.
  const fieldJobs = crewedToday.length > 0 ? crewedToday : inProgress;
  const onlyJob = fieldJobs.length === 1 ? `&job=${fieldJobs[0]!.id}` : "";
  const takePhoto = canReach(principal, "/photos") ? pickJob("Take a photo", fieldJobs, "photos", "add a photo") : null;
  const quick = [
    ...(takePhoto ? [{ icon: "◉", shortcut: takePhoto }] : []),
    ...(rfisReachable ? [{ icon: "?", shortcut: { label: "New RFI", href: `/rfis?new=1${onlyJob}` } }] : []),
    ...(canReach(principal, "/field-reports") ? [{ icon: "✎", shortcut: { label: "Daily report", href: `/field-reports?new=1${onlyJob}` } }] : []),
  ];
  const chips = [
    ...(logHours ? [{ icon: "◷", shortcut: logHours }] : []),
    ...(sendPayApp ? [{ icon: "↗", shortcut: sendPayApp }] : []),
    ...(rfisReachable ? [{ icon: "?", shortcut: { label: "Find an RFI", href: "/rfis" } }] : []),
    ...quick,
  ];

  /* ---------------------------------------------------------- areas -- */
  // Each box's one line, from the same rows the pages read. Overdue money
  // and today's crews are already in hand above, so they are passed in.
  const areas = isNewAccount
    ? null
    : areaViews(
        areasFor(principal),
        await loadToolStatuses(company.id, principal, todayIso, {
          overdue: showsBilling ? { total: today.overdueTotal, count: today.overdue.length } : undefined,
          crewsOut: extras.crewsToday.length,
          inProgress: inProgress.length,
        }),
      );

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
            <div className="md:flex md:items-end md:justify-between md:gap-6">
              <div data-home="greeting">
                <h1 className="font-headline text-[32px] font-semibold leading-none text-ink md:text-[38px] md:leading-tight">
                  {hello}
                </h1>
                <p className="mt-1 text-[15px] text-ink-muted">{dateLine}</p>
              </div>
              {!onlyChecklist && <ShortcutChips newJob={!isNewAccount} others={isNewAccount ? [] : chips} />}
            </div>

            {/* ------------------------------------------------ areas -- */}
            {/* Where everything is. Once there is a job: before that every
                box would read zero, and the checklist is the one start. */}
            {areas && <AreaBoxes areas={areas} hours={logHours} />}

            {/* On a phone the foreman's one big action stays first, and the
                three things he creates from the field sit under it. */}
            {!isNewAccount && (logHours || quick.length > 0) && (
              <PhoneTiles primary={logHours ? { ...logHours, label: "Log today's hours" } : null} quick={quick} />
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
                      bill,
                      outstanding: today.receivables.reduce((sum, r) => sum + r.outstanding, 0),
                      overdueHref,
                      retainageHref,
                    }}
                  />
                )}
                {/* Running now shares the last column with Crews today, the
                    shortest block, so it costs the page no row of its own
                    (measured: under Needs you today it pushed Your jobs down
                    342px at 1440x900). The last card stretches to the row. */}
                <div className="flex min-w-0 flex-col gap-4 [&>section:last-child]:flex-1">
                  <CrewsBlock crews={extras.crewsToday} />
                  <RunningCard tasks={tasks} now={new Date()} />
                </div>
              </div>
            )}

            {/* ------------------------------------------- your jobs -- */}
            {!isNewAccount && (
              <section id="jobs" className="mt-5 scroll-mt-20" data-tour="dashboard-job-health">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h2 className="font-headline text-xl font-semibold text-ink">Your jobs</h2>
                  <Link href="/jobs" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink hover:underline">
                    All {allJobs.length} {allJobs.length === 1 ? "job" : "jobs"} &rarr;
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
              <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className="text-sm font-semibold text-ink">Accounts receivable</h3>
                  <p className="mb-2 text-xs text-ink-body">
                    Outstanding {bill.lowerMany}, longest overdue first. Open one for the detail.
                  </p>
                  <ReceivablesList />
                </Card>

                <Card>
                  <h3 className="text-sm font-semibold text-ink">How your GCs pay</h3>
                  {today.gcReliability.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-body">
                      No {bill.lowerMany} raised yet, so there is nothing to judge.{" "}
                      <Link href="/jobs" className="text-link hover:underline">
                        Open a job
                      </Link>{" "}
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

          </PageShell>
        </div>

        <ReceivablesDetailPanel />
      </div>
    </ReceivablesProvider>
  );
}
