import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/lib/theme";

type Accent = "rose" | "amber" | "green" | "blue" | "indigo" | "violet" | "teal";

const ACCENT_BAR: Record<Accent, string> = {
  rose: colors.barRose,
  amber: colors.barAmber,
  green: colors.barGreen,
  blue: colors.barBlue,
  indigo: colors.barIndigo,
  violet: colors.barViolet,
  teal: colors.barTeal,
};

/**
 * A surface, mirroring the web Card: light ground, hairline border, no
 * shadow. `accent` draws the 3px bar down the left edge, for summary
 * tiles only.
 */
export function Card({
  accent,
  children,
  style,
}: {
  accent?: Accent;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.card, style]}>
      {accent ? (
        <View style={[styles.bar, { backgroundColor: ACCENT_BAR[accent] }]} />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
    padding: 16,
  },
  bar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
});
