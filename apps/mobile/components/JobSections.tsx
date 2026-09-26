import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The four sections of a working day, switchable in place — drawn as an
 * iOS segmented control: one contained track, the active segment the
 * brand fill with its dark label (the one-yellow rule).
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
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <View style={styles.chrome}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
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
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    chrome: {
      backgroundColor: p.colors.rail,
      borderBottomWidth: 1,
      borderBottomColor: p.colors.lineCard,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
    },
    track: {
      flexDirection: "row",
      gap: 2,
      borderRadius: radius.field,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
      padding: space.two,
      flexGrow: 0,
    },
    segment: {
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: space.md,
      borderRadius: radius.field - 2,
    },
    // The brand fill always carries the dark label — the one rule this
    // palette makes easy to break.
    segmentActive: { backgroundColor: p.colors.brand },
    label: { color: p.colors.inkBody, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    labelActive: { color: p.colors.brandInk },
  });
}
