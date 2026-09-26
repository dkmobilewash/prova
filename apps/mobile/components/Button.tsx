import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { hitTarget, hitTargetPrimary, type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

type Variant = "primary" | "secondary" | "ghost";

/**
 * Primary = the brand yellow fill with a DARK label (yellow is a fill, never
 * text on a light canvas). Secondary = hairline on surface. Ghost = a link.
 * Min height 52pt, comfortably above the 44pt floor, and the label is 17pt
 * semibold — a gloved thumb hits it without aiming. Pressed = a 3% spring
 * scale (PressableScale), not the old opacity wash.
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
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        variant === "primary" && styles.primarySize,
        variantStyles(palette)[variant],
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, labelStyles(palette)[variant]]}>{children}</Text>
    </PressableScale>
  );
}

function variantStyles(p: Palette): Record<Variant, object> {
  return {
    primary: { backgroundColor: p.colors.brand },
    secondary: {
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
    },
    ghost: {},
  };
}

function labelStyles(p: Palette): Record<Variant, object> {
  return {
    primary: { color: p.colors.brandInk },
    secondary: { color: p.colors.ink },
    ghost: { color: p.colors.link },
  };
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    base: {
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.card,
      // The floor for any button; `primary` overrides it below. 52 was a
      // number nobody could name — it cleared Apple's 44 and missed the
      // 56 a primary action is supposed to be.
      minHeight: hitTarget,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    /** The one action a screen exists for — Save, Clock in, Sign and
     * finish — found by thumb while walking. See hitTargetPrimary. */
    primarySize: { minHeight: hitTargetPrimary },
    fullWidth: { alignSelf: "stretch" },
    disabled: { opacity: 0.4 },
    label: {
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
  });
}
