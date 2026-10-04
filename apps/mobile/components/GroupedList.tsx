import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { usePalette } from "@/lib/use-palette";
import { cardSurface, type Palette } from "@/lib/theme";

/**
 * The iOS inset-grouped list: one surface, hairline border, dividers owned
 * by the rows inside it. This is what replaced the card-for-everything
 * layout — cards survive only for standalone objects (the clock card, a
 * photo), and anything that is a LIST of rows lives in a group.
 *
 * LIFTED now, where the palette can show it. It was flat on purpose — "the
 * surface tone and the hairline do the depth work" — and that held while
 * canvas and surface were ~4% apart, which is to say it did not hold: the
 * hairline was doing all of it alone and the result read as an outlined
 * box rather than a surface. `cardSurface` gives this a shadow on light
 * and dark and keeps the border on outdoor, where a shadow is the first
 * thing sunlight destroys.
 *
 * `overflow: hidden` stays — the rows inside own their dividers and must
 * be clipped to the radius — and it is why the shadow has to sit on this
 * view rather than on a wrapper: iOS will not draw a shadow outside a
 * clipping bound, so the two cannot swap places.
 */
export function GroupedList({ children, style }: { children: ReactNode; style?: object }) {
  const palette = usePalette();
  const styles = makeStyles(palette);
  return <View style={[styles.group, style]}>{children}</View>;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    group: {
      ...cardSurface(p),
      overflow: "hidden",
    },
  });
}
