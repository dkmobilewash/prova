import { useEffect, useMemo, useState } from "react";
import { ClerkProvider } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { apiBaseUrl, clerkPublishableKey, configProblem } from "@/lib/env";
import { getHandover } from "@/lib/handover";
import { loadLanguage, useT } from "@/lib/i18n";
import { usePushTapRouter } from "@/lib/push";
import { tokenCache } from "@/lib/token-cache";
import { leadingFor, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import { useQueueDrain } from "@/lib/use-queue-drain";

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

/**
 * The saved language choice, read before the first frame is drawn.
 *
 * `lib/i18n.ts` already starts on the PHONE's language, synchronously,
 * so for almost everybody this gate changes nothing — it is over before
 * anything would have painted. It exists for the person whose choice
 * differs from their phone: rendering first and correcting afterwards
 * flashes English at a Spanish reader on every single launch, which is
 * the kind of detail that tells somebody the app was not built for them.
 *
 * `loadLanguage` cannot throw (see its comment), which is what makes
 * holding the frame on it safe.
 */
function LanguageGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadLanguage().then(() => setReady(true));
  }, []);

  if (!ready) return null;
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

/** The one place a notification tap is answered. Mounted inside
 * ClerkProvider and OUTSIDE the handover gate, so the listener stays
 * alive while the phone is in a crew member's hands — and the swallow
 * still works, which is the point. */
function PushTapRouter() {
  usePushTapRouter();
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
  const { t, language } = useT();

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
      headerBackTitle: t("nav.back"),
    }),
    // `language` is here BECAUSE the rule cannot see it. `t` is a module
    // function with a stable identity, so a memo keyed on `t` alone never
    // recomputes and the header keeps whatever language it was first
    // rendered in — English, for anyone who switches. What actually
    // changes is `language`, which the memo does not name because it
    // reads it THROUGH `t`. eslint is right that nothing in the body
    // mentions it and wrong about what that means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette, t, language],
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
      {/* Mounted beside the drain and OUTSIDE both gates, so the listener
          stays alive while the phone is in a crew member's hands. */}
      <PushTapRouter />
      {/* The language is read before the handover is, so the handover
          screen itself speaks the right language — it is the one screen
          a crew member sees before anything else. */}
      <LanguageGate>
        <HandoverGate>
          <Stack screenOptions={screenOptions}>
            {/* The title is never shown — the tabs draw their own headers. */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
            <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
            <Stack.Screen name="job/[jobId]" options={{ title: t("nav.job") }} />
            <Stack.Screen name="reports/[jobId]" options={{ title: t("nav.reports") }} />
            <Stack.Screen name="photos/[jobId]" options={{ title: t("nav.photos") }} />
            <Stack.Screen name="safety/[jobId]" options={{ title: t("nav.safety") }} />
            <Stack.Screen name="time/[jobId]" options={{ title: t("nav.time") }} />
            <Stack.Screen name="materials/[jobId]" options={{ title: t("nav.materials") }} />
            <Stack.Screen name="punch-list/[jobId]" options={{ title: t("nav.punch") }} />
            <Stack.Screen name="ticket/[jobId]" options={{ title: t("nav.ticket") }} />
            <Stack.Screen name="drawings/[jobId]" options={{ title: t("nav.drawings") }} />
            <Stack.Screen name="schedule/[jobId]" options={{ title: t("nav.schedule") }} />
            <Stack.Screen name="outbox" options={{ title: t("nav.outbox") }} />
            <Stack.Screen name="alerts" options={{ title: t("nav.alerts") }} />
            {/* No header and no swipe-back: the way out of a handover is
                handing the phone back, not an iOS gesture. */}
            <Stack.Screen name="handover" options={{ headerShown: false, gestureEnabled: false }} />
          </Stack>
        </HandoverGate>
      </LanguageGate>
    </ClerkProvider>
  );
}
