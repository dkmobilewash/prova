import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getHandover } from "./handover";
import { targetFromData } from "./push-target";
import * as api from "./api";

/** Show push notifications while the app is in the foreground too — a
 * foreman mid-task should still see the banner, not have it buried. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Ask for permission, get this device's Expo push token, and register it
 * with the backend for the signed-in user. No-op in the simulator (push
 * needs a physical device) and when permission is refused. */
export async function registerForPush(token: string): Promise<void> {
  if (!Device.isDevice) return;

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const request = await Notifications.requestPermissionsAsync();
    granted = request.granted;
  }
  if (!granted) return;

  const pushToken = (await Notifications.getExpoPushTokenAsync()).data;
  await api.registerDeviceToken(
    { expoToken: pushToken, platform: Platform.OS === "ios" ? "ios" : "android" },
    token,
  );
}

/**
 * The one place a notification TAP is answered.
 *
 * Cold start: the OS holds the response; `getLastNotificationResponse`
 * reads it and `clearLastNotificationResponse` consumes it — a tap we
 * swallowed must never replay on the next launch. Warm: the listener sees
 * the tap live. Both routes run the same gate first: a handover in
 * progress swallows the tap entirely, because the way out of a handover
 * is handing the phone back, not a notification.
 *
 * Mounted in the root layout, inside ClerkProvider and OUTSIDE the
 * handover gate, so the listener stays alive while the phone is in a
 * crew member's hands and the swallow still works.
 */
export function usePushTapRouter(): void {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const routeTap = async (data: Record<string, unknown> | null | undefined) => {
      const target = targetFromData(data);
      if (!target) return;

      // Never navigate out of a handover. The check lives INSIDE the
      // routing step, so cold and warm taps both pass through it.
      const open = await getHandover();
      if (open) return;

      if (!mounted) return;
      if (target === "/alerts") {
        router.push("/alerts");
      } else if (target.startsWith("/job/")) {
        router.push({
          pathname: "/job/[jobId]",
          params: { jobId: target.slice("/job/".length) },
        });
      }
    };

    // Cold start. Consumed unconditionally on read: the tap is answered
    // (or deliberately swallowed) by OUR decision, so the OS must not
    // hand it to the next launch.
    const last = Notifications.getLastNotificationResponse();
    if (last && last.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      Notifications.clearLastNotificationResponse();
      void routeTap(last.notification.request.content.data);
    }

    // Warm taps.
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        void routeTap(response.notification.request.content.data);
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [router]);
}
