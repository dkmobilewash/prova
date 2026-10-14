import { prisma } from "@prova/db";
import { PageColumn } from "@prova/ui";
import { DailyFieldReports } from "@/components/DailyFieldReports";
import { DelayLog } from "@/components/DelayLog";
import { refreshReportWeather } from "@/lib/report-weather";
import { loadManpower, manpowerLine } from "@/lib/manpower";
import { siteWeatherNote, weatherLine, type DayWeather } from "@/lib/weather";
import {
  DELAY_CAUSES,
  NOTIFICATION_METHODS,
  RESPONSIBLE_PARTIES,
  causeLabel,
  formatMinutes,
  methodLabel,
  partyLabel,
} from "@/lib/delays-core";
import { requireJob } from "@/lib/jobs/job-access";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { SeeAll, seeAllWindow } from "@/components/SeeAll";

/**
 * Field reports — a daily log of what happened on site, plus the delay
 * log nested inside it (unchanged pairing from the monolith:
 * `<DailyFieldReports>…<DelayLog /></DailyFieldReports>`). Ungated as a
 * route, exactly as the monolith left it — this section carried no
 * capability check there, unlike the Photos gallery next to it.
 */
export default async function JobFieldReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { id } = await params;
  // The latest 7 reports, each a one-line row; ?all=1 for every one
  // (declutter, density audit #8 — this list was uncapped and expanded).
  const reportWindow = seeAllWindow((await searchParams).all);
  const { currentUser, job: jobRef } = await requireJob(id);

  const job = await prisma.job.findUnique({
    where: { id: jobRef.id },
    select: {
      id: true,
      siteAddress: true,
      siteLatitude: true,
      siteLongitude: true,
      siteTimeZone: true,
      dailyFieldReports: {
        orderBy: { reportDate: "desc" },
        take: reportWindow.take,
        include: { filedBy: true, _count: { select: { media: true } } },
      },
      _count: { select: { dailyFieldReports: true } },
      delayEvents: {
        orderBy: [{ date: "desc" }, { createdAt: "asc" }],
        take: 100,
        include: { changeOrder: { select: { number: true } } },
      },
    },
  });
  if (!job) throw new Error("job disappeared between checks");

  const reportWeather = await refreshReportWeather(job, job.dailyFieldReports);
  const reportManpower = await loadManpower(job.id, job.dailyFieldReports.map((r) => r.reportDate));
  const timeZone = await viewerTimeZone();
  const delayDays = new Set(job.delayEvents.map((d) => d.date.toISOString().slice(0, 10)));

  // Days with a live timesheet sign-off — the delay log shows the same
  // "locked" label the Crew tab's time entries do, for a day whose hours
  // are already signed.
  const lockedTimeDays = new Map(
    (
      await prisma.timesheetSignoff.findMany({
        where: { jobId: job.id, reopenedAt: null },
        select: { date: true, approvedAt: true },
      })
    ).map((s) => [s.date.toISOString().slice(0, 10), s.approvedAt ? "Approved" : "Signed"]),
  );

  // A composer and a column of written reports: reading width, for line
  // length. The layout above is `working`; see PageColumn.
  return (
    <PageColumn width="reading">
    <DailyFieldReports
      jobId={job.id}
      canDelete={currentUser.role === "OWNER"}
      siteNote={siteWeatherNote(job)}
      reports={job.dailyFieldReports.map((report) => {
        const auto = (reportWeather.get(report.id) ?? report.weatherAuto) as DayWeather | null;
        const day = report.reportDate.toISOString().slice(0, 10);
        const manpower = reportManpower.get(day) ?? { headcount: 0, hours: 0, byCraft: [] };
        return {
          id: report.id,
          reportDate: report.reportDate.toISOString(),
          crewPresent: report.crewPresent,
          workPerformed: report.workPerformed,
          weather: report.weather,
          delays: report.delays,
          filedByName: report.filedBy?.name ?? null,
          weatherAutoLine: auto ? weatherLine(auto) : null,
          weatherAutoKind: auto?.kind ?? null,
          manpowerLine: manpowerLine(manpower),
          manpower: { headcount: manpower.headcount, hours: manpower.hours },
          hasDelayEvent: delayDays.has(day),
          lockedLabel: lockedTimeDays.get(day) ?? null,
          photoCount: report._count.media,
        };
      })}
      seeAll={
        <SeeAll
          total={job._count.dailyFieldReports}
          limit={reportWindow.limit}
          showingAll={reportWindow.showingAll}
          noun="reports"
        />
      }
    >
      <DelayLog
        jobId={job.id}
        causes={DELAY_CAUSES}
        parties={RESPONSIBLE_PARTIES}
        methods={NOTIFICATION_METHODS}
        canDraftChangeOrder={jobRef.status !== "ESTIMATE"}
        delays={job.delayEvents.map((d) => ({
          id: d.id,
          dateLabel: formatCalendarDate(d.date),
          causeLabel: causeLabel(d.cause),
          responsibleLabel: partyLabel(d.responsibleParty),
          responsibleName: d.responsibleName,
          start: formatMinutes(d.startMinute),
          end: formatMinutes(d.endMinute),
          workersAffected: d.workersAffected,
          hoursLost: d.hoursLost === null ? null : String(Number(d.hoursLost)),
          description: d.description,
          notifiedLabel: d.gcNotifiedHow
            ? [methodLabel(d.gcNotifiedHow), d.gcNotifiedWho, d.gcNotifiedAt ? formatInstant(d.gcNotifiedAt, timeZone) : null]
                .filter(Boolean)
                .join(" · ")
            : null,
          changeOrderLabel: d.changeOrder ? `CO #${d.changeOrder.number}` : null,
          lockedLabel: lockedTimeDays.get(d.date.toISOString().slice(0, 10)) ?? null,
        }))}
      />
    </DailyFieldReports>
    </PageColumn>
  );
}
