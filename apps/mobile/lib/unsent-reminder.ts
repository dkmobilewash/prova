import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

/**
 * The end-of-day reminder that something never reached the office.
 *
 * The case it is for is specific and it is the one that costs money: a
 * foreman logs eight hours in a basement, the queue holds them because
 * there is no signal, he puts the phone in his pocket, drives home, and
 * nothing ever asks again. The office is short a day of time and finds
 * out on Friday, if at all. A count on a screen he is not looking at is
 * not a safeguard.
 *
 * LOCAL, not push, and that is the whole design. The server cannot know
 * what this phone is holding — that is what "unsent" means — so a push
 * would have to be told by the phone, over the network that is missing.
 * A local notification is scheduled by the device, fires with no
 * connection at all, and needs nothing from anybody. `expo-notifications`
 * is already in the build for #294's push, so this adds no native module.
 *
 * Scheduled only while something is actually waiting, and cancelled the
 * moment the queue drains — a reminder that fires on an empty queue
 * teaches people to ignore it, and then it is worth nothing on the day it
 * matters.
 */

const HOUR_KEY = "prova.unsent-reminder.hour";
const ID_KEY = "prova.unsent-reminder.id";

/** The hours offered in Settings, plus "off". Late afternoon, because the
 * point is to catch it while the day can still be fixed. */
export const REMINDER_CHOICES = [16, 17, 18, null] as const;
export const DEFAULT_HOUR = 17;

export function formatHour(hour: number | null): string {
  if (hour === null) return "Off";
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

export async function reminderHour(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(HOUR_KEY);
  if (raw === null) return DEFAULT_HOUR;
  if (raw === "off") return null;
  const hour = Number(raw);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR;
}

export async function setReminderHour(hour: number | null): Promise<void> {
  await AsyncStorage.setItem(HOUR_KEY, hour === null ? "off" : String(hour));
}

/**
 * Asks for notification permission at the moment somebody picks a time,
 * which is the only moment the request makes sense.
 *
 * Without this the feature would be silently dead for anyone who declined
 * the push prompt at sign-in, or never saw it: `reconcileReminder` checks
 * permission and gives up quietly, which is right for a background
 * reconcile and useless as an answer to "why didn't it remind me". Returns
 * whether it can actually fire, so Settings can say so rather than showing
 * a time that means nothing.
 */
export async function ensureReminderPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync().catch(() => null);
  if (existing?.granted) return true;
  const asked = await Notifications.requestPermissionsAsync().catch(() => null);
  return asked?.granted ?? false;
}

/**
 * Brings the scheduled reminder into line with what the phone is holding.
 * Called whenever the queue changes — after a save, after a flush — so it
 * is always the CURRENT count in the sentence, and so it disappears when
 * the last write goes up.
 */
export async function reconcileReminder(pending: number, now: Date = new Date()): Promise<void> {
  const existing = await AsyncStorage.getItem(ID_KEY);
  if (existing) {
    await Notifications.cancelScheduledNotificationAsync(existing).catch(() => {});
    await AsyncStorage.removeItem(ID_KEY);
  }
  if (pending <= 0) return;

  const hour = await reminderHour();
  if (hour === null) return;

  const granted = (await Notifications.getPermissionsAsync().catch(() => null))?.granted ?? false;
  if (!granted) return;

  const when = new Date(now);
  when.setHours(hour, 0, 0, 0);
  // Past that hour already: tomorrow, not in a few milliseconds. Somebody
  // saving at 6pm with the reminder on 5pm gets it tomorrow evening,
  // which is the next time it could still be acted on.
  if (when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "Not everything has reached the office",
      body:
        pending === 1
          ? "1 change from this phone hasn't been sent. Open Prova with signal to send it."
          : `${pending} changes from this phone haven't been sent. Open Prova with signal to send them.`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  }).catch(() => null);

  if (id) await AsyncStorage.setItem(ID_KEY, id);
}
