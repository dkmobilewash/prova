import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";
import type { CurrentJob } from "@/lib/current-job";

/**
 * Which job you are on, on every tab that acts on one.
 *
 * It is a control, not a label: tapping it goes to the Jobs tab to switch.
 * Without this the Create and Camera tabs would be doing something to a
 * job the screen never names, which is the kind of quiet mistake that ends
 * up as a photo filed against the wrong site.
 */
export function CurrentJobBar({ job }: { job: CurrentJob | null }) {
  return (
    <Pressable
      onPress={() => router.navigate("/(tabs)/jobs")}
      style={styles.bar}
      accessibilityRole="button"
      accessibilityLabel={job ? `On ${job.name}. Tap to switch job.` : "Pick a job"}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{job ? "On this job" : "No job picked"}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {job ? job.name : "Choose one to get started"}
        </Text>
      </View>
      <Text style={styles.switch}>{job ? "Switch" : "Pick"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    backgroundColor: colors.rail,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineCard,
  },
  text: { flex: 1 },
  label: { color: colors.inkMuted, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  name: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  switch: { color: colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
