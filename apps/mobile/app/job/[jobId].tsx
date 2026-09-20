import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { setCurrentJob } from "@/lib/current-job";
import { Icon } from "@/components/Icon";
import { Row } from "@/components/Row";
import { StatusBadge } from "@/components/StatusBadge";
import { colors, typography } from "@/lib/theme";

// One row per field feature. Icon names are the app's own vocabulary and
// resolve in lib/icon-glyphs.ts — never a glyph name here.
const FEATURES = [
  { icon: "report", title: "Field reports", subtitle: "Daily reports, queued offline", path: "reports" },
  { icon: "photos", title: "Photos", subtitle: "Site photos and videos", path: "photos" },
  { icon: "safety", title: "Safety", subtitle: "Toolbox talks and incidents", path: "safety" },
  { icon: "time", title: "Time", subtitle: "Log the day's hours", path: "time" },
  { icon: "materials", title: "Materials", subtitle: "Vendors and orders", path: "materials" },
  { icon: "punch", title: "Punch list", subtitle: "What's left to fix", path: "punch-list" },
  { icon: "ticket", title: "T&M ticket", subtitle: "Signed time & materials", path: "ticket" },
] as const;

/** The hub for one job: the job's name and status, then every field feature
 * as a large tappable row. The jobs list now lands here instead of dropping
 * straight into field reports, so the whole field toolkit is one thumb's
 * reach from the tap that opened the job. */
export default function JobHubScreen() {
  const { jobId, name, status } = useLocalSearchParams<{
    jobId: string;
    name?: string;
    status?: string;
  }>();

  // Opening a job is how you choose one. The jobs list sets this too, but
  // a notification or a link lands here without passing through it, and
  // Home, Create and Camera would otherwise still be pointing at whatever
  // job you were on last week.
  useEffect(() => {
    if (jobId) void setCurrentJob({ id: jobId, name: name ?? "Job", status: status ?? null });
  }, [jobId, name, status]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.name}>{name ?? "Job"}</Text>
        {status ? <StatusBadge status={status} /> : null}
      </View>

      <View style={styles.panel}>
        {FEATURES.map((feature, i) => (
          <View key={feature.path}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <Row
              icon={<Icon name={feature.icon} />}
              title={feature.title}
              subtitle={feature.subtitle}
              onPress={() => router.push(`/${feature.path}/${jobId}`)}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 16 },
  header: { gap: 8, paddingVertical: 4 },
  name: {
    color: colors.ink,
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
  },
  panel: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.lineRow, marginLeft: 56 },
});
