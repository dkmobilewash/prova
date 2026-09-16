import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, hitTarget, typography } from "@/lib/theme";

/**
 * One tappable list row — title (bold), optional subtitle and trailing
 * value, a chevron when it navigates. Min height is the 44pt floor, but
 * padding makes it taller; the whole row is the target, not just the text.
 */
export function Row({
  title,
  subtitle,
  value,
  icon,
  onPress,
  chevron = true,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && onPress && styles.pressed,
      ]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {chevron && onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: hitTarget,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  pressed: { opacity: 0.7 },
  icon: { width: 28, alignItems: "center" },
  body: { flex: 1, gap: 2 },
  title: {
    color: colors.ink,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  subtitle: { color: colors.inkBody, fontSize: typography.size.sm },
  value: { color: colors.inkBody, fontSize: typography.size.md },
  chevron: { color: colors.inkMuted, fontSize: 24, fontWeight: typography.weight.bold },
});
