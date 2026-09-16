import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, hitTarget, typography } from "@/lib/theme";

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
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, input.multiline && styles.multiline, input.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: {
    color: colors.inkLabel,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  input: {
    minHeight: hitTarget,
    borderWidth: 1,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: typography.size.md,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  error: { color: colors.tagRoseInk, fontSize: typography.size.sm },
});
