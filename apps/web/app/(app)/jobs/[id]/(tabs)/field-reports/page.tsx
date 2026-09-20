import { prisma } from "@prova/db";
import { DailyFieldReports } from "@/components/DailyFieldReports";
import { DelayLog } from "@/components/DelayLog";
import { refreshReportWeather } from "@/lib/report-weather";
import { loadManpower, manpowerLine } from "@/lib/manpower";
import { weatherLine, type DayWeather } from "@/lib/weather";
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

/**
 * Field reports — a daily log of what happened on site, plus the delay
 * log nested inside it (unchanged pairing from the monolith:
 * `<DailyFieldReports>…<DelayLog /></DailyFieldReports>`). Ungated as a
 * route, exactly as the monolith left it — this section carried no
 * capability check there, unlike the Photos gallery next to it.
 */
export default async function JobFieldReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
        include: { filedBy: true, _count: { select: { media: true } } },
      },
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

  return (
    <DailyFieldReports
      jobId={job.id}
      canDelete={currentUser.role === "OWNER"}
      siteNote={
        job.siteLatitude === null
          ? job.siteAddress
            ? "Weather can't be filled in: the site address above wasn't found on a map. Try a street address or \"City, ST\"."
            : "Add the job's site address on the Overview tab and each report fills in the day's weather automatically."
          : null
      }
      reports={job.dailyFieldReports.map((report) => {
        const auto = (reportWeather.get(report.id) ?? report.weatherAuto) as DayWeather | null;
        const day = report.reportDate.toISOString().slice(0, 10);
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
          manpowerLine: manpowerLine(reportManpower.get(day) ?? { headcount: 0, hours: 0, byCraft: [] }),
          lockedLabel: lockedTimeDays.get(day) ?? null,
          photoCount: report._count.media,
        };
      })}
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
  );
}
