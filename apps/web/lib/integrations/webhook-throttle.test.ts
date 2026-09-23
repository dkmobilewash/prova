import { describe, expect, it } from "vitest";
import { WEBHOOK_LOG_WINDOW_MS, shouldRecordWebhook } from "./webhook-throttle";

describe("shouldRecordWebhook", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");

  it("records the first delivery for a connection", () => {
    expect(shouldRecordWebhook(null, now)).toBe(true);
  });

  it("does not record a second delivery inside the window", () => {
    const justNow = new Date(now.getTime() - 5_000);
    expect(shouldRecordWebhook(justNow, now)).toBe(false);
    const oneMsShort = new Date(now.getTime() - WEBHOOK_LOG_WINDOW_MS + 1);
    expect(shouldRecordWebhook(oneMsShort, now)).toBe(false);
  });

  it("records again once the window has passed", () => {
    const exactlyWindow = new Date(now.getTime() - WEBHOOK_LOG_WINDOW_MS);
    expect(shouldRecordWebhook(exactlyWindow, now)).toBe(true);
    const longAgo = new Date(now.getTime() - 10 * WEBHOOK_LOG_WINDOW_MS);
    expect(shouldRecordWebhook(longAgo, now)).toBe(true);
  });

  it("ignores a clock that went backwards rather than recording on it", () => {
    const future = new Date(now.getTime() + 30_000);
    expect(shouldRecordWebhook(future, now)).toBe(false);
  });
});
