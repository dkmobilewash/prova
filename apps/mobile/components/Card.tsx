import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { cardSurface, type Palette, space } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * A standalone surface — lifted off the canvas by `cardSurface`, which
 * gives it a shadow where the palette can show one and keeps the hairline
 * on outdoor, where it cannot. Deliberately RARE now: lists of rows live in GroupedList,
 * and this survives only for objects that stand alone on the canvas (the
 * clock card on Time, a photo, an outbox item). The old `accent` bar prop
 * was deleted — no screen ever used it, and a colour on everything is a
 * colour that says nothing.
 */
export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return <View style={[styles.card, style]}>{children}</View>;
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    card: {
      ...cardSurface(p),
      padding: space.md,
    },
  });
}
