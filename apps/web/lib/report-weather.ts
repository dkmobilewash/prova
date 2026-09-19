import { prisma, type Prisma } from "@prova/db";
import { fetchDayWeather, weatherIsStale } from "@/lib/weather";

/**
 * Fills in, or brings up to date, the automatic weather on a job's daily
 * reports: a report with none gets the day's weather; a stored FORECAST whose
 * day is now over is replaced with the observed day. An observed day is final
 * and never fetched again.
 *
 * Capped per call, because a page render is not a batch job: the newest
 * reports are the ones anyone is looking at, and the rest catch up the next
 * time the page loads.
 *
 * Writes only `weatherAuto`, which is the one column the DailyFieldReport
 * day-lock trigger lets change on a signed day — the weather arriving is an
 * outside fact, not an edit to what the foreman signed.
 */
export async function refreshReportWeather(
  job: { id: string; siteLatitude: number | null; siteLongitude: number | null; siteTimeZone: string | null },
  reports: { id: string; reportDate: Date; weatherAuto: unknown }[],
  limit = 4,
): Promise<Map<string, Prisma.JsonValue>> {
  const updated = new Map<string, Prisma.JsonValue>();
  if (job.siteLatitude === null || job.siteLongitude === null) return updated;
  const now = new Date();
  const stale = reports.filter((r) => weatherIsStale(r.weatherAuto, now)).slice(0, limit);
  await Promise.all(
    stale.map(async (report) => {
      const date = report.reportDate.toISOString().slice(0, 10);
      const weather = await fetchDayWeather({ latitude: job.siteLatitude!, longitude: job.siteLongitude! }, date, now);
      if (!weather) return;
      const { timeZone, ...stored } = weather;
      try {
        await prisma.dailyFieldReport.update({
          where: { id: report.id },
          data: { weatherAuto: stored as Prisma.InputJsonValue },
        });
        updated.set(report.id, stored as Prisma.JsonValue);
      } catch {
        // A report deleted between the read and this write: nothing to fill.
      }
      if (timeZone && !job.siteTimeZone) {
        await prisma.job.update({ where: { id: job.id }, data: { siteTimeZone: timeZone } }).catch(() => {});
      }
    }),
  );
  return updated;
}
