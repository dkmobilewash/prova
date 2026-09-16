import { StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";

/**
 * Job status (and integration state) as a tag — a light ground under a dark
 * saturated ink, so the meaning survives on a sunlit white canvas.
 */
const STYLES: Record<string, { bg: string; ink: string }> = {
  ESTIMATE: { bg: colors.tagSlate, ink: colors.tagSlateInk },
  CONTRACTED: { bg: colors.tagBlue, ink: colors.tagBlueInk },
  IN_PROGRESS: { bg: colors.tagAmber, ink: colors.tagAmberInk },
  COMPLETE: { bg: colors.tagGreen, ink: colors.tagGreenInk },
  SIGNED: { bg: colors.tagGreen, ink: colors.tagGreenInk },
  CONNECTED: { bg: colors.tagGreen, ink: colors.tagGreenInk },
  NOT_CONNECTED: { bg: colors.tagSlate, ink: colors.tagSlateInk },
  NEEDS_REAUTH: { bg: colors.tagAmber, ink: colors.tagAmberInk },
  ERROR: { bg: colors.tagRose, ink: colors.tagRoseInk },
};

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

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? { bg: colors.tagSlate, ink: colors.tagSlateInk };
  const label = LABELS[status] ?? status;

  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.label, { color: style.ink }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
