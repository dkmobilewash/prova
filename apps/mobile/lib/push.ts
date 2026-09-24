import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import * as api from "./api";
import { expoProjectId } from "./push-project-id";

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

  // PASSED EXPLICITLY, not left to be inferred. Expo's docs: the value
  // "defaults to Constants.expoConfig.extra.eas.projectId … When using
  // EAS Build, this value is automatically set. However, it is
  // recommended to set it manually" — and the case that matters here is
  // the one where inference fails, a development build, which is the
  // only kind this app has ever run as. Without an id the call throws,
  // and this function is fire-and-forget at launch: the throw would be
  // swallowed and push would simply never work, with nothing said.
  const projectId = expoProjectId(Constants);
  if (!projectId) {
    console.warn(
      "[push] no EAS project id in the app config — this build cannot register for push",
    );
    return;
  }

  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.registerDeviceToken(
    { expoToken: pushToken, platform: Platform.OS === "ios" ? "ios" : "android" },
    token,
  );
}
