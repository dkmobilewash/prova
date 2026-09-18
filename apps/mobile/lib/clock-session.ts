import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "prova.clock-session";

/** The running interval on this device — clocked in but not yet closed.
 * Persisted to AsyncStorage so an OS app-kill mid-shift does not lose the
 * clock-in time. The TimeEntry row is only written when the interval closes
 * (switch or clock-out). */
export type OpenClockSession = {
  clockStartedAt: string; // ISO timestamp
  jobId: string;
  lineItemId: string | null;
  craftClassificationId: string | null;
  breakMinutes: number; // unpaid break, whole minutes
};

/** Worked duration (end − start) minus the unpaid break, as a decimal-hours
 * string for TimeEntry.hours. This is the phone's ONLY authority over the
 * figure — it computes duration, never the pay-type split (that is entered by
 * a person; see lib/prevailing-wage.ts on the web side). Rounded to
 * hundredths of an hour (~36s). */
export function hoursFromClockInterval(
  startedAt: string,
  endedAt: string,
  breakMinutes: number,
): string {
  const workedMinutes =
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000 - breakMinutes;
  const hours = Math.max(0, workedMinutes) / 60;
  return String(Math.round(hours * 100) / 100);
}

/** The payroll day an interval belongs to — the clock-in day on the DEVICE's
 * local calendar, so a night shift starting 7pm Monday (Pacific) is attributed
 * to Monday, not the UTC Tuesday. The web side stores this as UTC midnight,
 * the same convention a hand-typed date already follows. */
export function dayFromClockIn(startedAt: string): string {
  const d = new Date(startedAt);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export async function getOpenSession(): Promise<OpenClockSession | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OpenClockSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: OpenClockSession): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
