import { vi } from "vitest";

// React 19 wants to know it is being driven by `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * What a screen needs around it to mount outside a phone, and nothing
 * more.
 *
 * Every mock here stands for a NATIVE thing — navigation, the icon font,
 * the device keystore, Clerk's session — never for the app's own logic.
 * The cache, the sync queue, `cachedRead`, the screens and the components
 * are the real ones, because they are what these tests are about.
 */

// Navigation. `useFocusEffect` is React's effect: in a test the screen is
// mounted and therefore focused. `router` and `useRouter` share the same
// fns, so a test can assert on `router.push` what a mounted hook did
// through `useRouter().push`.
const routerPush = vi.fn();
const routerReplace = vi.fn();
const routerBack = vi.fn();
vi.mock("expo-router", async () => {
  const react = await import("react");
  return {
    useLocalSearchParams: () => ({ jobId: "job_1" }),
    useRouter: () => ({
      push: routerPush,
      replace: routerReplace,
      back: routerBack,
    }),
    router: { push: routerPush, replace: routerReplace, back: routerBack },
    useFocusEffect: (effect: () => void | (() => void)) => react.useEffect(effect, [effect]),
    Redirect: () => null,
    Link: ({ children }: { children?: unknown }) => children ?? null,
  };
});

// The icon font is a native asset; the glyph names are covered by
// icon-names.test.ts.
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: () => null }));

// Clerk. A token that resolves is the ONLINE case; a test that wants the
// offline one makes the API reject, which is what a phone does.
vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: async () => "test_token" }),
}));

// The device keystore, backing the cache and the queue.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: "/tmp" },
  UploadType: { MULTIPART: "multipart" },
}));

vi.mock("expo-image-picker", () => ({
  launchCameraAsync: async () => ({ canceled: true }),
  launchImageLibraryAsync: async () => ({ canceled: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  MediaTypeOptions: { Images: "Images" },
}));

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({ status: "denied" }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 5 } }),
  Accuracy: { Balanced: 3 },
}));

vi.mock("react-native-view-shot", () => ({
  default: () => null,
  captureRef: async () => "file:///stamped.jpg",
}));

vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: false }),
  requestPermissionsAsync: async () => ({ granted: false }),
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[test]" }),
  scheduleNotificationAsync: async () => "id_1",
  cancelScheduledNotificationAsync: async () => {},
  // The tap half. vi.fn so a test can reach inside with vi.mocked; the
  // listener is whatever the mock was handed, read back via mock.calls.
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  getLastNotificationResponse: vi.fn(() => null),
  clearLastNotificationResponse: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
}));

vi.mock("expo-device", () => ({ isDevice: false }));

vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => false, shareAsync: async () => {} }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({ type: "dismiss" }) }));

/** The device store, for a test that wants to seed or clear the cache. */
export const deviceStore = store;

/**
 * The API, OFFLINE BY DEFAULT.
 *
 * Every `list*`/`get*` call rejects the way a phone with no signal does,
 * because that is the state these tests are about; a test that wants a
 * server answer says so for the one call it cares about:
 *
 *     vi.mocked(api.listTimeEntries).mockResolvedValue([entry]);
 *
 * Derived from the real module rather than restated, so a new endpoint is
 * offline here the day it is added instead of being quietly undefined.
 */
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = { ...actual };
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== "function") continue;
    if (!/^(list|get)/.test(name)) continue;
    mocked[name] = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });
  }
  return mocked;
});

/** Put every API call back to "no signal" — what a test means by turning
 * Airplane Mode on between two mounts. Applied to the SAME module
 * instance the screen holds, so it must not be combined with
 * `vi.resetModules()` between the two. */
export async function goOffline(): Promise<void> {
  const api = await import("@/lib/api");
  for (const value of Object.values(api)) {
    if (typeof value === "function" && "mockImplementation" in value) {
      (value as unknown as { mockImplementation: (fn: () => Promise<never>) => void }).mockImplementation(async () => {
        throw new TypeError("Network request failed");
      });
    }
  }
}
