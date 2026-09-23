import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Palette, radius, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * Job status (and integration state) as a tag — the same pairs the web
 * uses, light ground under dark ink in light mode and the reverse in dark,
 * so a chip means the same thing on both. `CONTRACTED` is the one that
 * keeps the brand fill with dark ink, which is the web's "In progress"
 * chip. 13pt on purpose: it is secondary metadata beside a 17pt title.
 */
const LABELS: Record<string, string> = {
  ESTIMATE: "Estimate",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  SIGNED: "Signed",
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
  NEEDS_REAUTH: "Needs reauth",
  ERROR: "Error",
};

function pairFor(p: Palette, status: string): { bg: string; ink: string } {
  const c = p.colors;
  const pairs: Record<string, { bg: string; ink: string }> = {
    ESTIMATE: { bg: c.tagSlate, ink: c.tagSlateInk },
    CONTRACTED: { bg: c.tagBlue, ink: c.tagBlueInk },
    IN_PROGRESS: { bg: c.tagAmber, ink: c.tagAmberInk },
    COMPLETE: { bg: c.tagGreen, ink: c.tagGreenInk },
    SIGNED: { bg: c.tagGreen, ink: c.tagGreenInk },
    CONNECTED: { bg: c.tagGreen, ink: c.tagGreenInk },
    NOT_CONNECTED: { bg: c.tagSlate, ink: c.tagSlateInk },
    NEEDS_REAUTH: { bg: c.tagAmber, ink: c.tagAmberInk },
    ERROR: { bg: c.tagRose, ink: c.tagRoseInk },
  };
  return pairs[status] ?? { bg: c.tagSlate, ink: c.tagSlateInk };
}

export function StatusBadge({ status }: { status: string }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { bg, ink } = pairFor(palette, status);

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: ink }]}>{LABELS[status] ?? status}</Text>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    badge: {
      alignSelf: "flex-start",
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 3,
    },
    label: { fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  });
}
