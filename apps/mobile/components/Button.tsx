import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "@/lib/theme";

type Variant = "primary" | "secondary" | "ghost";

/**
 * The web Button (packages/ui/src/Button.tsx), reimplemented natively:
 * primary = brand fill, secondary = hairline on surface, ghost = body text.
 */
export function Button({
  variant = "primary",
  onPress,
  disabled,
  children,
}: {
  variant?: Variant;
  onPress?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
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
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 14, fontWeight: "500" },
});

const variantStyles: Record<Variant, object> = {
  primary: { backgroundColor: colors.brand },
  secondary: { borderWidth: 1, borderColor: colors.lineCard, backgroundColor: colors.surface },
  ghost: {},
};

const labelStyles: Record<Variant, object> = {
  primary: { color: "#ffffff" },
  secondary: { color: colors.inkLabel },
  ghost: { color: colors.inkBody },
};
