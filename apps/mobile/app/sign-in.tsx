import { useAuth, useOAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function SignInScreen() {
  const { isSignedIn } = useAuth();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });

  if (isSignedIn) return <Redirect href="/" />;

  const onPress = async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow();
      // The OAuth flow creates the session server-side; `setActive` makes it
      // the app's active session so `isSignedIn` flips and we redirect.
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (err) {
      // "You're already signed in" is the race where the session exists but
      // `isSignedIn` hasn't flipped yet — swallowing it lets the redirect
      // above fire on the next render.
      console.error("OAuth error", err);
    }
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text>Sign in to file field reports</Text>
      <Pressable
        onPress={onPress}
        style={{ backgroundColor: "#111", borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: "#fff", textAlign: "center" }}>Continue with Google</Text>
      </Pressable>
    </View>
  );
}
