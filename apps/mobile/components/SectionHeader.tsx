import { StyleSheet, Text } from "react-native";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * An iOS grouped-section header: 13pt semibold uppercase in the quietest
 * ink, with the slight tracking that says "label, not content". The
 * section-title convention for every grouped list on the new screens.
 */
export function SectionHeader({
  children,
  style,
  uppercase = true,
}: {
  children: string;
  style?: object;
  /** Pinned copy keeps its own case — "Waiting to send" is tested
   * letter-for-letter, and uppercasing it in the component would be the
   * design system rewriting the product's words. */
  uppercase?: boolean;
}) {
  const palette = usePalette();
  const styles = makeStyles(palette);
  return <Text style={[styles.header, style]}>{uppercase ? children.toUpperCase() : children}</Text>;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    header: {
      color: p.colors.inkMuted,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
      letterSpacing: 0.5,
      paddingHorizontal: space.md,
      paddingTop: space.lg,
      paddingBottom: space.xs,
    },
  });
}
