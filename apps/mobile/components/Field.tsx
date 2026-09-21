import { useMemo } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { type Palette, hitTarget, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * A labelled input. The label sits above the field, the input is at least
 * the 44pt floor with 17pt text (16px is the iOS zoom threshold — anything
 * smaller and iOS zooms the whole screen when the field focuses). `error`
 * renders an inline message in the error ink.
 */
export function Field({
  label,
  error,
  ...input
}: { label: string; error?: string } & TextInputProps) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={palette.colors.inkMuted}
        style={[styles.input, input.multiline && styles.multiline, input.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { gap: space.six },
    label: {
      color: p.colors.inkLabel,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
    input: {
      minHeight: hitTarget,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
      borderRadius: radius.field,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: p.colors.ink,
      fontSize: typography.size.md,
    },
    multiline: { minHeight: 96, textAlignVertical: "top" },
    error: { color: p.colors.tagRoseInk, fontSize: typography.size.sm },
  });
}
