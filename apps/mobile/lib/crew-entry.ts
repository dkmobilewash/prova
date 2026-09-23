import type { TimeEntry } from "./types";

/** "me" for the signed-in user, or a crew member's id. */
export type WorkerKey = "me" | `crew:${string}`;

export const crewKey = (id: string): WorkerKey => `crew:${id}`;
export const crewIdOf = (key: WorkerKey): string | null => (key === "me" ? null : key.slice(5));

/** One person on the crew sheet. `hours` null means "the hours for everyone";
 * a value is that person's own — a late arrival or an early out. */
export type CrewRow = { worker: WorkerKey; hours: string | null; craftId: string | null };

/** A positive number of hours, up to two decimals, at most a day — the same
 * rule the server applies, so a row the server would refuse is caught here
 * rather than stranding the offline queue behind it. */
export function isValidHours(text: string): boolean {
  const t = text.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return false;
  const n = Number(t);
  return n > 0 && n <= 24;
}

export function isValidDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00Z`).getTime());
}

/** Hours rounded for display/entry: "8", "7.5", "7.25". */
function hoursText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export type CopiedDay = {
  date: string;
  rows: CrewRow[];
  /** Only when every entry that day used the same one. */
  lineItemId: string | null;
  payType: string | null;
  /** The hours most people worked — becomes "hours for everyone". */
  sharedHours: string;
};

/**
 * The crew from the most recent day before `today` with hours on this job —
 * the "Copy from yesterday" a foreman taps instead of re-picking fourteen
 * people. One row per person: their total hours that day, under the craft
 * they spent most of it on. A person who switched crafts gets one row, not
 * two; the sheet is a starting point to adjust, not a replay.
 *
 * Returns null when there is no earlier day to copy.
 */
export function copyFromLastDay(entries: TimeEntry[], today: string): CopiedDay | null {
  const earlier = entries.filter((e) => e.date < today);
  if (earlier.length === 0) return null;
  const date = earlier.reduce((latest, e) => (e.date > latest ? e.date : latest), earlier[0].date);
  const day = earlier.filter((e) => e.date === date);

  const byWorker = new Map<WorkerKey, { total: number; byCraft: Map<string | null, number> }>();
  for (const e of day) {
    // An entry for a teammate who is not the signed-in user and not crew
    // (another login) cannot be re-entered from this phone; skip it.
    const worker: WorkerKey | null = e.crewMemberId ? crewKey(e.crewMemberId) : e.mine ? "me" : null;
    if (!worker) continue;
    const hours = Number(e.hours);
    const slot = byWorker.get(worker) ?? { total: 0, byCraft: new Map<string | null, number>() };
    slot.total += hours;
    const craft = e.craftClassificationId ?? null;
    slot.byCraft.set(craft, (slot.byCraft.get(craft) ?? 0) + hours);
    byWorker.set(worker, slot);
  }
  if (byWorker.size === 0) return null;

  // The most common total becomes "hours for everyone"; anyone different
  // keeps their own number.
  const counts = new Map<string, number>();
  for (const { total } of byWorker.values()) {
    const key = hoursText(total);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sharedHours = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const rows: CrewRow[] = [...byWorker.entries()].map(([worker, { total, byCraft }]) => {
    const [craftId] = [...byCraft.entries()].sort((a, b) => b[1] - a[1])[0];
    const own = hoursText(total);
    return { worker, hours: own === sharedHours ? null : own, craftId };
  });

  const same = <T,>(values: T[]): T | null => (values.every((v) => v === values[0]) ? values[0] : null);
  return {
    date,
    rows,
    lineItemId: same(day.map((e) => e.lineItemId ?? null)),
    payType: same(day.map((e) => e.payType)),
    sharedHours,
  };
}
