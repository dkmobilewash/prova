import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { useT } from "@/lib/i18n";
import { hitTarget, type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * A way out of a screen that nothing navigated to.
 *
 * FOUND ON A PHONE, 2026-09-28, the first time anybody reached `/alerts`
 * at all. It is the one screen in this app with no route into it except a
 * notification tap — no tab, no link, no button — and a tap that launches
 * the app COLD leaves it as the only entry on the stack. No back chevron,
 * because there is genuinely nothing behind it. The alert list was a room
 * with the door bricked up: you could read your alerts and then nothing,
 * not Home, not Jobs, until you force-quit the app.
 *
 * Every other pushed screen has a back chevron because you got there from
 * inside the app. This one is reached from outside it, which is exactly
 * the case the stack cannot supply an answer for.
 *
 * `replace` rather than `push`, matching `handover.tsx`: leaving here is
 * leaving, and the stack must not keep growing a screen nobody can return
 * to. `(tabs)` lands on Home with the tab bar back, which is the other
 * half of the complaint — from there Jobs is one tap away.
 *
 * Rendered only when `canGoBack()` is false, so a warm tap that pushed
 * this on top of real history keeps its ordinary Back and nobody gets two
 * competing ways out of the same screen.
 */
export function HeaderHomeButton() {
  const router = useRouter();
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <PressableScale
      onPress={() => router.replace("/(tabs)")}
      accessibilityRole="button"
      accessibilityLabel={t("nav.home")}
      // The header bar is shorter than the 48pt floor, so the TARGET is
      // grown outwards instead of the box: `hitSlop` is what a gloved
      // thumb actually hits, and `minHeight` alone would overflow the bar.
      hitSlop={{
        top: space.sm,
        bottom: space.sm,
        left: space.md,
        right: space.md,
      }}
      style={styles.button}
    >
      <Text style={styles.label}>{t("nav.home")}</Text>
    </PressableScale>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    button: {
      justifyContent: "center",
      paddingVertical: space.xxs,
      paddingRight: space.sm,
      // Declared so the touch-target census can see it: with hitSlop above
      // this clears `hitTarget` in every direction a thumb arrives from.
      minHeight: hitTarget - space.md,
    },
    label: {
      color: p.colors.brand,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
  });
}
