import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { usePalette } from "@/lib/use-palette";
import { type Palette, radius } from "@/lib/theme";

/**
 * The iOS inset-grouped list: one surface, hairline border, dividers owned
 * by the rows inside it. This is what replaced the card-for-everything
 * layout — cards survive only for standalone objects (the clock card, a
 * photo), and anything that is a LIST of rows lives in a group.
 *
 * Flat on purpose: the surface tone and the hairline do the depth work,
 * per the brief ("the interface should feel almost flat until depth is
 * needed").
 */
export function GroupedList({ children, style }: { children: ReactNode; style?: object }) {
  const palette = usePalette();
  const styles = makeStyles(palette);
  return <View style={[styles.group, style]}>{children}</View>;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    group: {
      backgroundColor: p.colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      overflow: "hidden",
    },
  });
}
