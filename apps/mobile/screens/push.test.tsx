import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { usePushTapRouter } from "@/lib/push";
import { deviceStore } from "./setup";
import { mount } from "./render";

/**
 * The tap router, rendered — the cold-start branch fires on mount, warm
 * taps are replayed through the listener the mock was handed. What is
 * worth testing is not that it renders but that a tap ANSWERS: the cold
 * response is consumed even when swallowed, only the DEFAULT action
 * navigates, and a handover open on disk swallows the tap entirely —
 * the way out of a handover is handing the phone back, not a
 * notification.
 */

function Harness() {
  usePushTapRouter();
  return null;
}

function tapResponse(data: Record<string, unknown> | null | undefined) {
  return {
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: { request: { content: { data } } },
  };
}

beforeEach(() => {
  deviceStore.clear();
  vi.mocked(router.push).mockClear();
  vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
  vi.mocked(Notifications.clearLastNotificationResponse).mockClear();
  vi.mocked(Notifications.addNotificationResponseReceivedListener).mockClear();
});

describe("the tap router, cold start", () => {
  it("opens the alerts screen and consumes the tap", async () => {
    vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue(
      tapResponse({ target: "alerts" }) as never,
    );
    const screen = await mount(<Harness />);

    expect(vi.mocked(router.push)).toHaveBeenCalledWith("/alerts");
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  it("opens the job the assignment push names", async () => {
    vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue(
      tapResponse({ jobId: "job_7" }) as never,
    );
    const screen = await mount(<Harness />);

    expect(vi.mocked(router.push)).toHaveBeenCalledWith({
      pathname: "/job/[jobId]",
      params: { jobId: "job_7" },
    });
    screen.unmount();
  });

  it("ignores a custom action and leaves it unconsumed", async () => {
    vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue({
      actionIdentifier: "REPLY",
      notification: { request: { content: { data: { target: "alerts" } } } },
    } as never);
    const screen = await mount(<Harness />);

    expect(vi.mocked(router.push)).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("swallows the tap during a handover, and still consumes it", async () => {
    deviceStore.set(
      "prova.handover",
      JSON.stringify({ crewMemberId: "cm_1", name: "Ana", jobId: "job_1", jobName: "ZZQB-TEST" }),
    );
    vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue(
      tapResponse({ target: "alerts" }) as never,
    );
    const screen = await mount(<Harness />);

    expect(vi.mocked(router.push)).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    screen.unmount();
  });
});

describe("the tap router, warm taps", () => {
  it("routes a tap that arrives while the app is open", async () => {
    const screen = await mount(<Harness />);
    const listener =
      vi.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]?.[0];
    expect(listener, "no warm-tap listener registered").toBeTruthy();

    listener!(tapResponse({ target: "alerts" }) as never);
    await screen.settle();

    expect(vi.mocked(router.push)).toHaveBeenCalledWith("/alerts");
    screen.unmount();
  });

  it("swallows a warm tap during a handover", async () => {
    deviceStore.set(
      "prova.handover",
      JSON.stringify({ crewMemberId: "cm_1", name: "Ana", jobId: "job_1", jobName: "ZZQB-TEST" }),
    );
    const screen = await mount(<Harness />);
    const listener =
      vi.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]?.[0];
    expect(listener, "no warm-tap listener registered").toBeTruthy();

    listener!(tapResponse({ target: "alerts" }) as never);
    await screen.settle();

    expect(vi.mocked(router.push)).not.toHaveBeenCalled();
    screen.unmount();
  });
});
