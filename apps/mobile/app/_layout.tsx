import { ClerkProvider } from "@clerk/expo";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { colors, typography } from "@/lib/theme";

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
} as const;

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {/* Light glyphs: the chrome is #171717 now, and the default dark
          status bar text disappeared into it. */}
      <StatusBar style="light" />
      <Stack screenOptions={screenOptions}>
        {/* The title is never shown (the tabs draw their own header), but iOS
            uses it as the back-button label on every screen pushed from here —
            without it that label read "(tabs)". */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Jobs" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
        <Stack.Screen name="job/[jobId]" options={{ title: "Job" }} />
        <Stack.Screen name="reports/[jobId]" options={{ title: "Field reports" }} />
        <Stack.Screen name="photos/[jobId]" options={{ title: "Photos" }} />
        <Stack.Screen name="safety/[jobId]" options={{ title: "Safety" }} />
        <Stack.Screen name="time/[jobId]" options={{ title: "Time" }} />
        <Stack.Screen name="materials/[jobId]" options={{ title: "Materials" }} />
        <Stack.Screen name="punch-list/[jobId]" options={{ title: "Punch list" }} />
        <Stack.Screen name="ticket/[jobId]" options={{ title: "T&M ticket" }} />
      </Stack>
    </ClerkProvider>
  );
}
