import { prisma } from "@prova/db";

/**
 * A day's crew, read from its TimeEntry rows instead of retyped on the daily
 * report. Payroll already knows who worked, for how long and under which
 * craft; the report shows that and cannot disagree with it.
 *
 * Headcount is distinct PEOPLE (a crew member or a login), not entries — one
 * person who switched cost codes has two entries and counts once. A person
 * who worked under two crafts counts once in the total and once under each
 * craft, which is how a craft-by-craft manpower line is read on site.
 */
export type Manpower = {
  headcount: number;
  hours: number;
  byCraft: { craft: string; headcount: number; hours: number }[];
};

export type ManpowerEntry = {
  hours: unknown;
  employeeUserId: string | null;
  crewMemberId: string | null;
  craftClassification: { name: string } | null;
};

const UNTAGGED = "No craft";

export function summarizeManpower(entries: ManpowerEntry[]): Manpower {
  const people = new Set<string>();
  let hours = 0;
  const crafts = new Map<string, { people: Set<string>; hours: number }>();
  for (const e of entries) {
    const who = e.crewMemberId ? `crew:${e.crewMemberId}` : `user:${e.employeeUserId ?? "unknown"}`;
    const h = Number(e.hours) || 0;
    people.add(who);
    hours += h;
    const craft = e.craftClassification?.name ?? UNTAGGED;
    const slot = crafts.get(craft) ?? { people: new Set<string>(), hours: 0 };
    slot.people.add(who);
    slot.hours += h;
    crafts.set(craft, slot);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    headcount: people.size,
    hours: round(hours),
    byCraft: [...crafts.entries()]
      .map(([craft, slot]) => ({ craft, headcount: slot.people.size, hours: round(slot.hours) }))
      // Largest first; the untagged bucket last, since it is the one to fix.
      .sort((a, b) => (a.craft === UNTAGGED ? 1 : b.craft === UNTAGGED ? -1 : b.hours - a.hours)),
  };
}

/** "4 people · 32h — Carpenter JM 3 · 24h, Carpenter App 1 · 8h". */
export function manpowerLine(m: Manpower): string {
  if (m.headcount === 0) return "No hours logged for this day";
  const who = `${m.headcount} ${m.headcount === 1 ? "person" : "people"} · ${m.hours}h`;
  if (m.byCraft.length <= 1 && m.byCraft[0]?.craft === UNTAGGED) return who;
  return `${who} — ${m.byCraft.map((c) => `${c.craft} ${c.headcount} · ${c.hours}h`).join(", ")}`;
}

/** Manpower for the reports on the company-wide log, keyed
 * `${jobId}:yyyy-mm-dd`, in one query over the date span they cover. */
export async function loadReportsManpower(
  companyId: string,
  reports: { jobId: string; reportDate: string }[],
): Promise<Map<string, Manpower>> {
  const out = new Map<string, Manpower>();
  if (reports.length === 0) return out;
  const days = reports.map((r) => r.reportDate).sort();
  const entries = await prisma.timeEntry.findMany({
    where: {
      job: { companyId },
      jobId: { in: [...new Set(reports.map((r) => r.jobId))] },
      date: { gte: new Date(`${days[0]}T00:00:00.000Z`), lte: new Date(`${days[days.length - 1]}T00:00:00.000Z`) },
    },
    select: { jobId: true, date: true, hours: true, employeeUserId: true, crewMemberId: true, craftClassification: { select: { name: true } } },
  });
  const byKey = new Map<string, ManpowerEntry[]>();
  for (const e of entries) {
    const key = `${e.jobId}:${e.date.toISOString().slice(0, 10)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  for (const r of reports) {
    const key = `${r.jobId}:${r.reportDate}`;
    out.set(key, summarizeManpower(byKey.get(key) ?? []));
  }
  return out;
}

/** Manpower for several days of one job, keyed yyyy-mm-dd, in one query. */
export async function loadManpower(jobId: string, dates: Date[]): Promise<Map<string, Manpower>> {
  const out = new Map<string, Manpower>();
  if (dates.length === 0) return out;
  const entries = await prisma.timeEntry.findMany({
    where: { jobId, date: { in: dates } },
    select: {
      date: true,
      hours: true,
      employeeUserId: true,
      crewMemberId: true,
      craftClassification: { select: { name: true } },
    },
  });
  const byDay = new Map<string, ManpowerEntry[]>();
  for (const e of entries) {
    const key = e.date.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    out.set(key, summarizeManpower(byDay.get(key) ?? []));
  }
  return out;
}
