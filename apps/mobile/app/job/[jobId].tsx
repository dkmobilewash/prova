import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { setCurrentJob } from "@/lib/current-job";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SCREEN_CAPABILITY } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import type { IconName } from "@/lib/icon-glyphs";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

// One row per field feature, grouped the way a day groups them: the four
// things that happen on a site TODAY, then the records a job accumulates.
// Icon names are the app's own vocabulary and resolve in lib/icon-glyphs.ts
// — never a glyph name here.
const FEATURES = [
  { icon: "report", title: "Field reports", subtitle: "Daily reports, queued offline", path: "reports", group: "day" },
  { icon: "photos", title: "Photos", subtitle: "Site photos and videos", path: "photos", group: "day" },
  { icon: "punch", title: "Punch list", subtitle: "What's left to fix", path: "punch-list", group: "day" },
  { icon: "time", title: "Time", subtitle: "Log the day's hours", path: "time", group: "day" },
  { icon: "safety", title: "Safety", subtitle: "Toolbox talks and incidents", path: "safety", group: "records" },
  { icon: "materials", title: "Materials", subtitle: "Vendors and orders", path: "materials", group: "records" },
  { icon: "ticket", title: "T&M ticket", subtitle: "Signed time & materials", path: "ticket", group: "records" },
  { icon: "drawings", title: "Drawings", subtitle: "Which revision governs", path: "drawings", group: "records" },
  { icon: "schedule", title: "Schedule", subtitle: "Who's on, and who never logged", path: "schedule", group: "records" },
] as const satisfies { icon: IconName; title: string; subtitle: string; path: string; group: "day" | "records" }[];

const GROUPS: { key: "day" | "records"; title: string }[] = [
  { key: "day", title: "The day" },
  { key: "records", title: "Job records" },
];

/** The hub for one job: the job's name and status, then every field feature
 * as a large tappable row — the four things a day is made of, then the
 * records the job accumulates. The jobs list now lands here instead of
 * dropping straight into field reports, so the whole field toolkit is one
 * thumb's reach from the tap that opened the job. */
export default function JobHubScreen() {
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId, name, status } = useLocalSearchParams<{
    jobId: string;
    name?: string;
    status?: string;
  }>();

  // Opening a job is how you choose one. The jobs list sets this too, but
  // a notification or a link lands here without passing through it, and
  // Home and the capture sheet would otherwise still be pointing at
  // whatever job you were on last week.
  useEffect(() => {
    if (jobId) void setCurrentJob({ id: jobId, name: name ?? "Job", status: status ?? null });
  }, [jobId, name, status]);

  // Only what this person can actually open. A row that leads to a 403 is
  // worse than no row: it reads as a broken app rather than as access
  // somebody else decides.
  const visible = FEATURES.filter((feature) =>
    holds(me, SCREEN_CAPABILITY[`${feature.path}/[jobId]`]),
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.name}>{name ?? "Job"}</Text>
        {status ? <StatusBadge status={status} /> : null}
      </View>

      {GROUPS.map((group) => {
        const rows = visible.filter((feature) => feature.group === group.key);
        if (rows.length === 0) return null;
        return (
          <View key={group.key}>
            <SectionHeader>{group.title}</SectionHeader>
            <GroupedList>
              {rows.map((feature, i) => (
                <GroupedRow
                  key={feature.path}
                  icon={<Icon name={feature.icon} />}
                  title={feature.title}
                  subtitle={feature.subtitle}
                  divider={i > 0}
                  onPress={() => router.push(`/${feature.path}/${jobId}`)}
                />
              ))}
            </GroupedList>
          </View>
        );
      })}

      {me && !holds(me, "MANAGE_FIELD") && !holds(me, "MANAGE_JOBS") ? (
        <Text style={styles.noneForYou}>
          Nothing on this job is part of your job function. The account owner sets who sees what, on
          the Team page.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    noneForYou: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 22, paddingTop: space.sm },
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: { padding: space.md, paddingBottom: space.xxl },
    header: { gap: space.xs, paddingVertical: space.xxs },
    name: {
      color: p.colors.ink,
      fontSize: typography.size.xl2,
      fontWeight: typography.weight.bold,
    },
  });
}
