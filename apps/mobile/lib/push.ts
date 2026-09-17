import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
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
