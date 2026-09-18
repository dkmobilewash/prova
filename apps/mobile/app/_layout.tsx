import { ClerkProvider } from "@clerk/expo";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";

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

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <Stack>
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
