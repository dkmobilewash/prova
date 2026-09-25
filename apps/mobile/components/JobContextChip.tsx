import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import { useCurrentJob } from "@/lib/use-current-job";
import { type Palette, hitTarget, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * Which job you are on, as a quiet one-line chip instead of the old 64pt
 * bar. It is a control, not a label: tapping it goes to the Jobs tab to
 * switch. Same copy and accessibility label as the old CurrentJobBar.
 */
export function JobContextChip() {
  const { job } = useCurrentJob();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { t } = useT();

  return (
    <Pressable
      onPress={() => router.navigate("/(tabs)/jobs")}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      // The job's own name is interpolated, never translated — it is what
      // the GC calls the site and what is printed on the paperwork.
      accessibilityLabel={job ? t("job.chip.a11y", { job: job.name }) : t("job.chip.a11yNone")}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{job ? t("job.chip.on") : t("job.chip.none")}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {job ? job.name : t("job.chip.choose")}
        </Text>
      </View>
      <Text style={styles.switch}>{job ? t("time.clock.switch") : t("job.chip.pick")}</Text>
      <Icon name="chevron" size={16} color={palette.colors.inkMuted} />
    </Pressable>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      minHeight: hitTarget,
      paddingVertical: space.xs,
      paddingHorizontal: space.md,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      borderRadius: radius.card,
      backgroundColor: p.colors.surface,
    },
    pressed: { backgroundColor: p.colors.railHover },
    text: { flex: 1 },
    label: {
      color: p.colors.inkMuted,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
    },
    name: {
      color: p.colors.ink,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
    switch: {
      color: p.colors.link,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
  });
}
