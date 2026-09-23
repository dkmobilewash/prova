import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { type Palette, radius, space } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * A standalone surface — hairline border, no shadow, exactly as the web
 * draws a card. Deliberately RARE now: lists of rows live in GroupedList,
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
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
      padding: space.md,
    },
  });
}
