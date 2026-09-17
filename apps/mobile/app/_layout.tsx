import { ClerkProvider } from "@clerk/expo";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

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

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
