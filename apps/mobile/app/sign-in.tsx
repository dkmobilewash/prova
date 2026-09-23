import { useAuth, useOAuth } from "@clerk/expo";
// The ROOT `useSignIn` in @clerk/expo 4.6 is Clerk's new resource shape
// (`signIn.password()`, `signIn.finalize()`, errors RETURNED not thrown).
// This screen uses the stable one the SDK still ships for exactly this
// flow; mixing is fine, both drive the same Clerk instance. Moving to the
// new shape is a deliberate change, not something to do by autocomplete.
import { useSignIn } from "@clerk/expo/legacy";
import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { isAlreadySignedIn, signInMessage } from "@/lib/clerk-error";
import { leadingFor, type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The one screen the whole company sees first.
 *
 * It offered Google and nothing else, which quietly decided who could
 * use the app: a framer with a personal address the office never linked
 * to Google had no way in at all. Email and password now sit first, with
 * Google kept underneath for everyone already using it.
 *
 * **Signing in, never signing up.** Creating an account here would make
 * a company, not join one — the API gives an address it has never seen
 * its own empty company (see requireCompanyContext), so a new crew
 * member would land in an app with no jobs and reasonably call it
 * broken. People are added by the office; their first sign-in adopts the
 * row already waiting for their verified email.
 *
 * The reset path is here rather than on the web because the person who
 * has forgotten a password is holding the phone, not sitting at a desk.
 */
export default function SignInScreen() {
  const { isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  /** password → the ordinary way in. forgot → asking for a code.
   *  code → the code has been sent and a new password is being set. */
  const [stage, setStage] = useState<"password" | "forgot" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every submit is disabled while one is in flight. Sign-in is not
  // idempotent from the person's side — a second tap during a slow
  // round-trip is how you get "too many requests" and lock yourself out
  // of a phone you were already signed into.
  const [busy, setBusy] = useState(false);

  if (isSignedIn) return <Redirect href="/" />;

  /** One place where a thrown Clerk error becomes a sentence, so no
   * branch below can forget to render the failure. */
  const attempt = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      if (isAlreadySignedIn(err)) return; // the redirect is one render away
      setError(signInMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = () =>
    attempt(async () => {
      if (!isLoaded || !signIn) return;
      const result = await signIn.create({ identifier: email.trim(), password });
      if (result.status === "complete" && setActive) {
        await setActive({ session: result.createdSessionId });
      } else {
        // No second factor is configured on this instance, so anything
        // other than "complete" is a state this screen cannot finish —
        // say so rather than leaving the person on a dead button.
        setError("This account needs another step. Sign in on the web once, then come back.");
      }
    });

  const sendResetCode = () =>
    attempt(async () => {
      if (!isLoaded || !signIn) return;
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim(),
      });
      setStage("code");
      setNote(`We sent a 6-digit code to ${email.trim()}.`);
    });

  const setNewPasswordAndSignIn = () =>
    attempt(async () => {
      if (!isLoaded || !signIn) return;
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
        password: newPassword,
      });
      if (result.status === "complete" && setActive) {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Password changed, but signing in needs another step. Try signing in above.");
        setStage("password");
      }
    });

  const continueWithGoogle = () =>
    attempt(async () => {
      const { createdSessionId, setActive: activate } = await startOAuthFlow();
      // The OAuth flow creates the session server-side; `setActive` makes
      // it the app's active session so `isSignedIn` flips and we redirect.
      if (createdSessionId && activate) await activate({ session: createdSessionId });
    });

  const back = () => {
    setStage("password");
    setError(null);
    setNote(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.mark}>
          <Text style={styles.markText}>CS</Text>
        </View>
        <Text style={styles.title}>C Stream</Text>
        <Text style={styles.subtitle}>Sign in to file field reports</Text>

        {stage === "password" ? (
          <View style={styles.form}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              returnKeyType="next"
              accessibilityLabel="Email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={signInWithPassword}
              accessibilityLabel="Password"
            />
            <Button fullWidth onPress={signInWithPassword} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                setStage("forgot");
                setError(null);
              }}
              disabled={busy}
            >
              Forgot password?
            </Button>
          </View>
        ) : null}

        {stage === "forgot" ? (
          <View style={styles.form}>
            <Text style={styles.body}>
              {"Type the email you sign in with. We'll send a 6-digit code to it."}
            </Text>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              accessibilityLabel="Email"
            />
            <Button fullWidth onPress={sendResetCode} disabled={busy}>
              {busy ? "Sending…" : "Email me a code"}
            </Button>
            <Button variant="ghost" onPress={back} disabled={busy}>
              Back to sign in
            </Button>
          </View>
        ) : null}

        {stage === "code" ? (
          <View style={styles.form}>
            {note ? <Text style={styles.body}>{note}</Text> : null}
            <Field
              label="Code from the email"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              accessibilityLabel="Code from the email"
            />
            <Field
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel="New password"
            />
            <Button fullWidth onPress={setNewPasswordAndSignIn} disabled={busy}>
              {busy ? "Setting…" : "Set password and sign in"}
            </Button>
            <Button variant="ghost" onPress={back} disabled={busy}>
              Back to sign in
            </Button>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.or}>or</Text>
          <View style={styles.rule} />
        </View>

        <Button variant="secondary" fullWidth onPress={continueWithGoogle} disabled={busy}>
          Continue with Google
        </Button>

        <Text style={styles.footnote}>
          New here? The office adds you first — then sign in with the email they used.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "stretch",
      padding: space.xl,
      gap: space.sm,
    },
    mark: {
      width: 64,
      height: 64,
      borderRadius: radius.card,
      backgroundColor: p.colors.brand,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
    },
    markText: {
      color: p.colors.brandInk,
      fontSize: typography.size.xl,
      fontWeight: typography.weight.bold,
    },
    title: {
      color: p.colors.ink,
      fontSize: typography.size.xxl,
      fontWeight: typography.weight.bold,
      textAlign: "center",
    },
    subtitle: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      textAlign: "center",
    },
    form: { gap: space.sm, marginTop: space.sm },
    body: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      lineHeight: leadingFor(typography.size.md),
    },
    error: {
      color: p.colors.tagRoseInk,
      fontSize: typography.size.md,
      lineHeight: leadingFor(typography.size.md),
      textAlign: "center",
    },
    divider: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
    rule: { flex: 1, height: 1, backgroundColor: p.colors.lineCard },
    or: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    footnote: {
      color: p.colors.inkMuted,
      fontSize: typography.size.sm,
      lineHeight: leadingFor(typography.size.sm),
      textAlign: "center",
      marginTop: space.sm,
    },
  });
}
