import { useEffect, useMemo, useState } from "react";
import { ClerkProvider } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { StyleSheet, Text, View } from "react-native";
import { apiBaseUrl, clerkPublishableKey, configProblem } from "@/lib/env";
import { getHandover } from "@/lib/handover";
import { leadingFor, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import { useQueueDrain } from "@/lib/use-queue-drain";



// Clerk stores the session token on-device; SecureStore (Keychain/Keystore)
// is the recommended cache for it on native. The storage key is namespaced
// by the publishable key so a session from a DIFFERENT Clerk instance (e.g.
// dev vs production) can never be read as this one's — switching instances
// starts signed-out instead of hanging on a foreign, unvalidatable token.
//
// The separator must be SecureStore-safe: keys allow only alphanumerics,
// '.', '-', and '_'. A ':' here threw "Invalid key provided to SecureStore"
// and silently stalled Clerk init (isLoaded stayed false).
const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(`${publishableKey}_${key}`);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(`${publishableKey}_${key}`, value);
    } catch {
      // best-effort — never block Clerk init on a cache write failure
    }
  },
};

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

/** The one drain timer for the whole app. It reads the session token
 * (useAuth), so it MUST mount inside ClerkProvider — and it must keep
 * running during a handover too, so it sits BESIDE the gate, not inside
 * it. The pre-hotfix code called useQueueDrain() directly in RootLayout,
 * above the provider, and red-screened every launch with "useAuth can
 * only be used within the ClerkProvider component". */
function DrainTimer() {
  useQueueDrain();
  return null;
}

/**
 * What a build that was never given its configuration says.
 *
 * Rendered INSTEAD of the app, and before ClerkProvider, for two
 * reasons: an empty publishable key throws inside the provider, and a
 * crash cannot explain itself. The old behaviour was worse than a crash
 * — the API URL fell back to localhost, so every screen reported "No
 * connection" and blamed the jobsite for a mistake made at build time.
 */
function ConfigProblem({ message }: { message: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.problem, { backgroundColor: palette.colors.canvas }]}>
      <Text style={[styles.problemTitle, { color: palette.colors.ink }]}>
        {"This build isn't finished"}
      </Text>
      <Text style={[styles.problemBody, { color: palette.colors.inkBody }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  problem: { flex: 1, justifyContent: "center", padding: space.xl, gap: space.sm },
  problemTitle: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  problemBody: { fontSize: typography.size.md, lineHeight: leadingFor(typography.size.md) },
});

export default function RootLayout() {
  const palette = usePalette();

  // Checked before anything else draws: a misconfigured build should say
  // what it is missing rather than impersonate a phone with no signal.
  const problem = configProblem({
    apiUrl: apiBaseUrl,
    clerkKey: clerkPublishableKey,
    isDev: __DEV__,
  });

  /** Every pushed screen wears the app's own chrome rather than the stock
   * iOS one. `rail` is deliberately LIFTED off the canvas — the same trick
   * the web's sidebar uses: the header recedes by being quiet, not by being
   * the one dark surface. Palette-aware: the chrome follows the system
   * appearance like everything else. */
  const screenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: palette.colors.rail },
      headerTintColor: palette.colors.brand, // the back chevron and its label
      headerTitleStyle: {
        color: palette.colors.ink,
        fontSize: typography.size.md,
        fontWeight: typography.weight.semibold,
      },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: palette.colors.canvas },
      // iOS labels Back with the PREVIOUS screen's title, which was fine when
      // there was one tab to come from and misleading now: a photo screen
      // opened from Home offered "Jobs". "Back" is true from all three tabs.
      headerBackTitle: "Back",
    }),
    [palette],
  );

  if (problem) return <ConfigProblem message={problem} />;

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
      {/* Auto follows the system appearance — the light palette needs dark
          glyphs, the dark palette needs light ones, and only the OS knows
          which is showing. */}
      <StatusBar style="auto" />
      {/* The drain lives HERE rather than on the tabs (where #403 put it)
          so the queue keeps going during a handover: a crew member's hours
          must not wait for the foreman to take the phone back. */}
      <DrainTimer />
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
