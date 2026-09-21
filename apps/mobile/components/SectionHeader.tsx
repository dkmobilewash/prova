import { StyleSheet, Text } from "react-native";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * An iOS grouped-section header: 13pt semibold uppercase in the quietest
 * ink, with the slight tracking that says "label, not content". The
 * section-title convention for every grouped list on the new screens.
 */
export function SectionHeader({ children, style }: { children: string; style?: object }) {
  const palette = usePalette();
  const styles = makeStyles(palette);
  return <Text style={[styles.header, style]}>{children.toUpperCase()}</Text>;
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
