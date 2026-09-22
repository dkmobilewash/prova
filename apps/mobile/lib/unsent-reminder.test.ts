import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reminder that something never reached the office.
 *
 * The case it exists for: eight hours logged in a basement, the phone in
 * a pocket, the drive home, and nothing ever asking again. The rules that
 * keep it worth listening to are all negative ones — it must not fire
 * when there is nothing waiting, must not fire seconds after being set,
 * and must not exist at all if the person turned it off.
 */

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

const scheduled: { at: Date; body: string }[] = [];
const cancelled: string[] = [];
let permission = true;

vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  getPermissionsAsync: async () => ({ granted: permission }),
  scheduleNotificationAsync: async (request: { content: { body: string }; trigger: { date: Date } }) => {
    scheduled.push({ at: request.trigger.date, body: request.content.body });
    return `id_${scheduled.length}`;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    cancelled.push(id);
  },
}));

const { reconcileReminder, reminderHour, setReminderHour, formatHour, DEFAULT_HOUR } = await import("./unsent-reminder");

beforeEach(() => {
  store.clear();
  scheduled.length = 0;
  cancelled.length = 0;
  permission = true;
});

describe("the end-of-day reminder", () => {
  it("is scheduled for this evening, saying how much is waiting", async () => {
    await reconcileReminder(3, new Date("2026-09-20T09:00:00"));
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].at.getHours()).toBe(DEFAULT_HOUR);
    expect(scheduled[0].at.getDate()).toBe(20);
    expect(scheduled[0].body).toContain("3 changes");
  });

  it("waits for tomorrow when the hour has already gone by", async () => {
    // Saving at six with the reminder on five must not fire immediately —
    // that is a notification about something the person is looking at.
    await reconcileReminder(1, new Date("2026-09-20T18:30:00"));
    expect(scheduled[0].at.getDate()).toBe(21);
    expect(scheduled[0].body).toContain("1 change");
  });

  it("does not exist when there is nothing waiting", async () => {
    await reconcileReminder(0, new Date("2026-09-20T09:00:00"));
    expect(scheduled).toEqual([]);
  });

  it("is cancelled the moment the last write goes up", async () => {
    await reconcileReminder(2, new Date("2026-09-20T09:00:00"));
    await reconcileReminder(0, new Date("2026-09-20T09:05:00"));
    expect(cancelled).toEqual(["id_1"]);
    expect(scheduled).toHaveLength(1);
  });

  it("re-states the count rather than stacking reminders", async () => {
    await reconcileReminder(1, new Date("2026-09-20T09:00:00"));
    await reconcileReminder(4, new Date("2026-09-20T09:01:00"));
    expect(cancelled).toEqual(["id_1"]);
    expect(scheduled).toHaveLength(2);
    expect(scheduled[1].body).toContain("4 changes");
  });

  it("does nothing at all when it is turned off", async () => {
    await setReminderHour(null);
    expect(await reminderHour()).toBeNull();
    await reconcileReminder(3, new Date("2026-09-20T09:00:00"));
    expect(scheduled).toEqual([]);
  });

  it("does not schedule what the phone has not been given permission to show", async () => {
    permission = false;
    await reconcileReminder(3, new Date("2026-09-20T09:00:00"));
    expect(scheduled).toEqual([]);
  });

  it("remembers the hour somebody picked", async () => {
    await setReminderHour(16);
    expect(await reminderHour()).toBe(16);
    await reconcileReminder(1, new Date("2026-09-20T09:00:00"));
    expect(scheduled[0].at.getHours()).toBe(16);
  });

  it("says the hour the way a person would", () => {
    expect(formatHour(16)).toBe("4pm");
    expect(formatHour(17)).toBe("5pm");
    expect(formatHour(null)).toBe("Off");
  });
});
