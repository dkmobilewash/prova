import type { ReactNode } from "react";
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";

/**
 * A bottom sheet for the create/edit forms. The primary action sits in the
 * bottom third — where a thumb holding the phone one-handed actually
 * reaches — not at the top of the screen. Tap the backdrop to dismiss.
 *
 * Never taller than the screen: the sheet is capped below the status bar and
 * the fields scroll between a fixed title and a fixed primary button. A long
 * form (Log time grew a craft note and chips) used to push its own title up
 * behind the status bar with no way to reach it.
 *
 * IT ALSO SITS ON TOP OF THE KEYBOARD RATHER THAN UNDER IT. Reported from
 * the site on 2026-09-20: typing into "Add item" on the punch list, the
 * keyboard covered the fields and you could not see what you were writing.
 * The sheet is pinned to the bottom of the screen, so it rides up by the
 * keyboard's height and its cap shrinks by the same amount — otherwise a
 * tall form would simply move the problem to the top of the screen.
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
  const keyboard = useKeyboardHeight();
  // 88% of what is left above the keyboard, not of the whole screen: the
  // cap is there to leave the status bar and a strip of backdrop reachable,
  // and both of those shrink when the keyboard is up.
  const available = Dimensions.get("window").height - keyboard;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { bottom: keyboard, maxHeight: Math.round(available * 0.88) }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{title}</Text>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
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
    // `bottom` and `maxHeight` are set inline from the keyboard's height —
    // see the note above the component.
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
  // Shrinks to fit when the sheet hits its cap; otherwise only as tall as
  // its content, so a short sheet stays short.
  scroll: { flexGrow: 0, flexShrink: 1 },
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
