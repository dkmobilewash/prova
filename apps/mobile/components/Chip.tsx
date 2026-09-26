import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { type Palette, hitTarget, radius, typography, space } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/** A single-select chip — pay type, vendor, classification. Selected = the
 * brand-yellow fill with a dark label; the whole pill is the target. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.selected]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </PressableScale>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    chip: {
      minHeight: hitTarget,
      paddingHorizontal: space.controlX,
      justifyContent: "center",
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
    },
    selected: { backgroundColor: p.colors.brand, borderColor: p.colors.brand },
    label: {
      color: p.colors.ink,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.medium,
    },
    labelSelected: { color: p.colors.brandInk, fontWeight: typography.weight.semibold },
  });
}
