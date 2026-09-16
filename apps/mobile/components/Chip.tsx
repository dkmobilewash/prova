import { Pressable, StyleSheet, Text } from "react-native";
import { colors, hitTarget, typography } from "@/lib/theme";

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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: hitTarget,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  pressed: { opacity: 0.85 },
  label: {
    color: colors.ink,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  labelSelected: { color: colors.brandInk, fontWeight: typography.weight.semibold },
});
