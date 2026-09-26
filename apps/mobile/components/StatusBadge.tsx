import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Palette, radius, statusPair, statusTokens, typography, space } from "@/lib/theme";
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
  // The pairs live in lib/theme.ts now, keyed by the DOMAIN they belong
  // to — a private copy here is how invoice states ended up with no
  // tokens at all and the next screen that needed "Overdue" would have
  // invented one. This component keeps only the lookup ORDER: a job
  // status wins over an integration one of the same name, because this
  // badge sits beside a job far more often than beside a connection.
  const pair = statusTokens.job[status as keyof typeof statusTokens.job]
    ? statusPair("job", status)
    : statusPair("integration", status);
  return { bg: p.colors[pair.bg], ink: p.colors[pair.ink] };
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
      paddingHorizontal: space.sm,
      paddingVertical: space.badge,
    },
    label: { fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  });
}
