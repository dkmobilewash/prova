import { useAuth, useOAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function SignInScreen() {
  const { isSignedIn } = useAuth();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });

  if (isSignedIn) return <Redirect href="/" />;

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text>Sign in to file field reports</Text>
      <Pressable
        onPress={() => startOAuthFlow()}
        style={{ backgroundColor: "#111", borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: "#fff", textAlign: "center" }}>Continue with Google</Text>
      </Pressable>
    </View>
  );
}
