import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { colors, typography } from "@/lib/theme";

/**
 * The four sections of a working day, switchable in place.
 *
 * Every section used to be a push from the job hub, so moving from photos
 * to the punch list meant back, read, tap — three gestures for something
 * that happens twenty times on a walkthrough. These switch with
 * `router.replace`, so the stack never grows and Back still means "leave
 * the job", not "undo the last four things I looked at".
 *
 * Only four, and only the daily ones. Safety, Materials and T&M stay as
 * rows on the job screen: a segmented control with seven segments is a
 * scrolling strip of 40pt targets, which is worse than the menu it
 * replaced.
 */
const SECTIONS = [
  { path: "reports", label: "Report" },
  { path: "photos", label: "Photos" },
  { path: "punch-list", label: "Punch" },
  { path: "time", label: "Time" },
] as const;

export type JobSection = (typeof SECTIONS)[number]["path"];

export function JobSections({ jobId, active }: { jobId: string; active: JobSection }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bar}
      // The strip is chrome: it should never take a drag that was meant
      // for the list underneath it.
      keyboardShouldPersistTaps="handled"
    >
      {SECTIONS.map((section) => {
        const isActive = section.path === active;
        return (
          <Pressable
            key={section.path}
            onPress={() => {
              if (!isActive) router.replace(`/${section.path}/${jobId}`);
            }}
            style={[styles.segment, isActive && styles.segmentActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{section.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.rail,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineCard,
  },
  segment: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
  },
  // The brand fill always carries the dark label — the one rule this
  // palette makes easy to break.
  segmentActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  label: { color: colors.inkBody, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  labelActive: { color: colors.brandInk },
});
