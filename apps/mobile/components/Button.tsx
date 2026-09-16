import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, typography } from "@/lib/theme";

type Variant = "primary" | "secondary" | "ghost";

/**
 * Primary = the brand yellow fill with a DARK label (yellow is a fill, never
 * text on a light canvas). Secondary = hairline on surface. Ghost = a link.
 * Min height 52pt, comfortably above the 44pt floor, and the label is 17pt
 * semibold — a gloved thumb hits it without aiming.
 */
export function Button({
  variant = "primary",
  onPress,
  disabled,
  fullWidth,
  children,
}: {
  variant?: Variant;
  onPress?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, labelStyles[variant]]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  fullWidth: { alignSelf: "stretch" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  label: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
});

const variantStyles: Record<Variant, object> = {
  primary: { backgroundColor: colors.brand },
  secondary: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
  },
  ghost: {},
};

const labelStyles: Record<Variant, object> = {
  primary: { color: colors.brandInk },
  secondary: { color: colors.ink },
  ghost: { color: colors.link },
};
