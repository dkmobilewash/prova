import { StyleSheet, Text } from "react-native";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The screen's top block on headerless tabs — 34pt bold, the HIG large
 * title. Deliberately static: iOS's scroll-collapse version needs
 * reanimated, which this app does not carry, and a title that does not
 * move is calmer than one that half-collapses.
 */
export function LargeTitle({ children, style }: { children: string; style?: object }) {
  const palette = usePalette();
  const styles = makeStyles(palette);
  return <Text style={[styles.title, style]}>{children}</Text>;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    title: {
      color: p.colors.ink,
      fontSize: typography.size.xl2,
      fontWeight: typography.weight.bold,
      paddingHorizontal: space.md,
      paddingTop: space.xs,
      paddingBottom: space.sm,
    },
  });
}
