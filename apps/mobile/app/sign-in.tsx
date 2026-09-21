import { useAuth, useOAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The one screen the whole company sees first — it used to be the only
 * unthemed screen in the app (raw inline styles, the light-mode hex-census
 * escape hatch). Now it wears the same system: the mark, the name, one
 * sentence, one button.
 */
export default function SignInScreen() {
  const { isSignedIn } = useAuth();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

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
    <View style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.mark}>
          <Text style={styles.markText}>CS</Text>
        </View>
        <Text style={styles.title}>C Stream</Text>
        <Text style={styles.subtitle}>Sign in to file field reports</Text>
        <View style={styles.buttonRow}>
          <Button fullWidth onPress={onPress}>
            Continue with Google
          </Button>
        </View>
      </View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: p.colors.canvas,
      justifyContent: "center",
      padding: space.xl,
    },
    content: { alignItems: "center", gap: space.sm },
    mark: {
      width: 64,
      height: 64,
      borderRadius: radius.card,
      backgroundColor: p.colors.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    markText: {
      color: p.colors.brandInk,
      fontSize: typography.size.xl,
      fontWeight: typography.weight.bold,
    },
    title: {
      color: p.colors.ink,
      fontSize: typography.size.xl2,
      fontWeight: typography.weight.bold,
      marginTop: space.xs,
    },
    subtitle: { color: p.colors.inkBody, fontSize: typography.size.md },
    buttonRow: { alignSelf: "stretch", marginTop: space.lg },
  });
}
