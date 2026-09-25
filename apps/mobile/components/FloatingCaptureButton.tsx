import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { PressableScale } from "@/components/PressableScale";
import { useT } from "@/lib/i18n";
import { type Palette, radius, shadow, space } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The floating capture button — the one yellow circle on screen, bottom
 * right above the tab bar. It is the whole "create anything" surface now
 * that Create and Camera are no longer tabs; the parent gates it behind
 * MANAGE_FIELD exactly as the old tabs were gated.
 *
 * The ONLY surface in the app that carries a shadow (shadow.floating):
 * a 56pt circle floating over scrolling content is the one thing that
 * earns elevation, per the brief — everything else stays flat.
 */
export function FloatingCaptureButton({ onPress }: { onPress: () => void }) {
  const palette = usePalette();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("capture.title")}
      style={[styles.button, { bottom: 49 + insets.bottom + space.md }]}
    >
      <Icon name="plus" size={26} color={palette.colors.brandInk} />
    </PressableScale>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    button: {
      position: "absolute",
      right: space.md,
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: p.colors.brand,
      alignItems: "center",
      justifyContent: "center",
      ...shadow.floating,
    },
  });
}
