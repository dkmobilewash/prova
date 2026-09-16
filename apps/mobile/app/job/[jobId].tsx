import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "@/components/Row";
import { StatusBadge } from "@/components/StatusBadge";
import { colors, typography } from "@/lib/theme";

// One row per field feature. Icons are emoji (the app's existing tab
// language) so there is no icon asset to add and keep in sync.
const FEATURES = [
  { icon: "📋", title: "Field reports", subtitle: "Daily reports, queued offline", path: "reports" },
  { icon: "📸", title: "Photos", subtitle: "Site photos and videos", path: "photos" },
  { icon: "🦺", title: "Safety", subtitle: "Toolbox talks and incidents", path: "safety" },
  { icon: "⏱️", title: "Time", subtitle: "Log the day's hours", path: "time" },
  { icon: "📦", title: "Materials", subtitle: "Vendors and orders", path: "materials" },
  { icon: "✅", title: "Punch list", subtitle: "What's left to fix", path: "punch-list" },
];

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
              icon={<Text style={styles.icon}>{feature.icon}</Text>}
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
  icon: { fontSize: 22 },
});
