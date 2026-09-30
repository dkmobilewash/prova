import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { useT } from "@/lib/i18n";
import { hitTargetPrimary, type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The way out of a screen a notification cold-started — IN THE BODY, on
 * purpose, after three header-based attempts rendered nothing on a phone.
 *
 * **Read this before moving it back into the header.** The history is the
 * argument:
 *
 *   1. #548 put `<Stack.Screen options={{ headerLeft }} />` inside
 *      `/alerts`. Shipped. Nothing rendered.
 *   2. #553 copied it to `/job/<id>`. Shipped. Nothing rendered.
 *   3. #554 moved it to the LAYOUT as an options function, on the grounds
 *      that `title` reaches these screens by that mechanism and was
 *      visibly working. Shipped. **Nothing rendered.**
 *
 * Three attempts, three silent failures, and not one of them could be seen
 * by any test in this repo — every instrument that could tell the
 * difference is a phone. Whatever the remaining reason is (the page-level
 * `setOptions` is skipped on a cold launch; a function passed as layout
 * `options` is spread into `{}` at `StackScreen.js:78`, since a function has
 * no enumerable own properties), the lesson does not depend on knowing it:
 * **the header is delivered by machinery this codebase cannot observe, and
 * three guesses at it is two too many.**
 *
 * A view in the screen body is rendered by React, the same way every other
 * pixel in this app is. It cannot be dropped by a navigator, it cannot
 * depend on focus or preload timing, and a test can see it. Less
 * iOS-conventional than a header button, and conventions are worth less
 * than a control that exists.
 *
 * **Conditional again as of 2026-09-29, and the order of events is the
 * point.** #555 shipped this unconditional on purpose: whether
 * `canGoBack()` is false on a cold tap was an INFERENCE drawn from the
 * missing back chevron, and after three fixes that rendered nothing, a
 * control that could hide itself was not a bet worth taking. Always
 * rendering costs a redundant button on a warm tap, which is cosmetic; the
 * inference being wrong costs somebody trapped for a fourth release.
 *
 * The inference is now an OBSERVATION. Diego tapped a notification from a
 * cold start on build 6 and reported the Home button present **and no back
 * chevron beside it** — which is `canGoBack()` returning false, seen rather
 * than reasoned. So the condition comes back, and it is a refinement on
 * working code rather than another attempt at a fix.
 *
 * What it buys: a warm tap pushed this on top of real history and that Back
 * is the right way out. Two exits from one screen is its own small
 * confusion, and the native chevron is the one that belongs to the stack.
 *
 * **The guard that makes this safe is behavioural, not structural.**
 * `screens/way-home.test.tsx` mounts the component both ways and asserts
 * what renders — so "hides when it should not" fails here, in node, rather
 * than on somebody's phone four releases later. A census could never have
 * caught the original defect and cannot catch this one; only mounting it
 * can.
 */
export function WayHome() {
  const router = useRouter();
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  // Observed false on a cold notification tap (build 6, 2026-09-29): no
  // back chevron, so the stack has nothing behind this screen and the
  // control is the only way off it.
  if (router.canGoBack()) return null;

  return (
    <PressableScale
      onPress={() => router.replace("/(tabs)")}
      accessibilityRole="button"
      accessibilityLabel={t("nav.home")}
      style={styles.button}
    >
      {/* `replace` and not `push`: leaving here is LEAVING, and a push
          would stack Home on top of the screen being escaped — the same
          reason handover.tsx replaces. `(tabs)` is what restores the tab
          bar, which is the other half of what was missing. */}
      <Text style={styles.label}>{t("nav.home")}</Text>
    </PressableScale>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    button: {
      // A primary action by the field rules — this is the only way off the
      // screen, so it gets the 56pt floor rather than the ordinary 48.
      minHeight: hitTargetPrimary,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
      marginTop: space.sm,
      marginBottom: space.xs,
      paddingHorizontal: space.md,
    },
    label: {
      // `link`, not `brand`: theme.ts's own rule is that the yellow is a
      // FILL and never text. `HeaderHomeButton` broke that — it coloured
      // its label `brand`, which is #facc15 on a near-white rail — and
      // nobody saw it, because the button it was on never rendered.
      color: p.colors.link,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
  });
}
