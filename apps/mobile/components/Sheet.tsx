import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";

/**
 * A bottom sheet for the create/edit forms. The primary action sits in the
 * bottom third — where a thumb holding the phone one-handed actually
 * reaches — not at the top of the screen. Tap the backdrop to dismiss.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  /** Greys the primary button out, e.g. until a required choice is made. */
  primaryDisabled?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{title}</Text>
        <View style={styles.body}>{children}</View>
        {primaryLabel && onPrimary ? (
          <Pressable
            onPress={onPrimary}
            disabled={primaryDisabled}
            style={({ pressed }) => [styles.primary, primaryDisabled && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>{primaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,10,10,0.4)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.lineCard,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.lineCard,
  },
  title: {
    color: colors.ink,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  body: { gap: 12 },
  primary: {
    minHeight: 52,
    backgroundColor: colors.brand,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  primaryLabel: {
    color: colors.brandInk,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
});
