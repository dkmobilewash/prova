import { ClerkProvider } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { colors, typography } from "@/lib/theme";
import { getHandover } from "@/lib/handover";
import { useQueueDrain } from "@/lib/use-queue-drain";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// Clerk stores the session token on-device; SecureStore (Keychain/Keystore)
// is the recommended cache for it on native.
const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
};

/** Every pushed screen wears the app's own chrome rather than the stock
 * iOS one. `rail` is deliberately LIFTED off the canvas (#171717 on
 * #0f0f0f) — the same trick the web's sidebar uses: the header recedes by
 * being quiet, not by being the one dark surface. */
const screenOptions = {
  headerStyle: { backgroundColor: colors.rail },
  headerTintColor: colors.brand, // the back chevron and its label
  headerTitleStyle: {
    color: colors.ink,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.canvas },
  // iOS labels Back with the PREVIOUS screen's title, which was fine when
  // there was one tab to come from and misleading now: a photo screen
  // opened from Home offered "Jobs". "Back" is true from all five tabs.
  headerBackTitle: "Back",
} as const;

/**
 * A handover survives a relaunch, and this is where that is enforced.
 *
 * The flag lives on disk (lib/handover.ts) precisely because React state
 * does not: a crew member who wanted out of the handover screen would
 * force-quit the app, and anything held in memory would hand them the
 * foreman's phone. So the app asks, before it draws anything, whether it
 * is currently in somebody else's hands.
 *
 * `null` means "haven't looked yet" and renders nothing at all — a frame
 * of the tabs before the redirect is exactly the frame worth not showing.
 */
function HandoverGate({ children }: { children: React.ReactNode }) {
  const [inHandover, setInHandover] = useState<boolean | null>(null);

  useEffect(() => {
    void getHandover().then((open) => setInHandover(!!open));
  }, []);

  if (inHandover === null) return null;
  if (inHandover) return <Redirect href="/handover" />;
  return <>{children}</>;
}

export default function RootLayout() {
  // One drain timer for the whole app, and it lives HERE rather than on
  // the tabs (where #403 put it) so the queue keeps going during a
  // handover too: a crew member's hours must not wait for the foreman to
  // take the phone back.
  useQueueDrain();

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {/* Light glyphs: the chrome is #171717 now, and the default dark
          status bar text disappeared into it. */}
      <StatusBar style="light" />
      <HandoverGate>
      <Stack screenOptions={screenOptions}>
        {/* The title is never shown — the tabs draw their own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
        <Stack.Screen name="job/[jobId]" options={{ title: "Job" }} />
        <Stack.Screen name="reports/[jobId]" options={{ title: "Field reports" }} />
        <Stack.Screen name="photos/[jobId]" options={{ title: "Photos" }} />
        <Stack.Screen name="safety/[jobId]" options={{ title: "Safety" }} />
        <Stack.Screen name="time/[jobId]" options={{ title: "Time" }} />
        <Stack.Screen name="materials/[jobId]" options={{ title: "Materials" }} />
        <Stack.Screen name="punch-list/[jobId]" options={{ title: "Punch list" }} />
        <Stack.Screen name="ticket/[jobId]" options={{ title: "T&M ticket" }} />
        <Stack.Screen name="drawings/[jobId]" options={{ title: "Drawings" }} />
        <Stack.Screen name="schedule/[jobId]" options={{ title: "Schedule" }} />
        <Stack.Screen name="outbox" options={{ title: "Waiting to send" }} />
        {/* No header and no swipe-back: the way out of a handover is
            handing the phone back, not an iOS gesture. */}
        <Stack.Screen name="handover" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
      </HandoverGate>
    </ClerkProvider>
  );
}
