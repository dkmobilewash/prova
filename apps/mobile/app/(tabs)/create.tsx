import { useAuth } from "@clerk/expo";
import { Redirect, router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { CurrentJobBar } from "@/components/CurrentJobBar";
import { Icon } from "@/components/Icon";
import { Row } from "@/components/Row";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { colors, typography } from "@/lib/theme";
import { useCurrentJob } from "@/lib/use-current-job";

/**
 * Everything you make on site, in the order a day makes them — against the
 * current job, so none of these ask which job first.
 *
 * This is a launcher and says so. The job screen's sections are where you
 * READ what exists; this is where you add, which is what a thumb wants
 * when both hands have been busy for an hour.
 */
const THINGS = [
  { icon: "report", title: "Field report", subtitle: "What got done today", path: "reports" },
  { icon: "photos", title: "Photo", subtitle: "Stamped with time and place", path: "photos" },
  { icon: "time", title: "Time", subtitle: "Hours for the crew", path: "time" },
  { icon: "punch", title: "Punch item", subtitle: "Something that needs fixing", path: "punch-list" },
  { icon: "safety", title: "Safety", subtitle: "Toolbox talk or an incident", path: "safety" },
  { icon: "materials", title: "Material order", subtitle: "What to get on site", path: "materials" },
  { icon: "ticket", title: "T&M ticket", subtitle: "Signed time and materials", path: "ticket" },
] as const;

export default function CreateScreen() {
  const { me } = useMe();
  const { isLoaded, isSignedIn } = useAuth();
  const { job, loading } = useCurrentJob();

  if (!isLoaded) return <Text style={styles.loading}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  if (!holds(me, "MANAGE_FIELD")) return <NotYourJobFunction what="Field records" />;

  return (
    <View style={styles.screen}>
      <CurrentJobBar job={job} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? null : !job ? (
          <Text style={styles.empty}>
            Pick a job first — everything here gets filed against one, and guessing which is how a
            photo ends up on the wrong site.
          </Text>
        ) : (
          <View style={styles.panel}>
            {THINGS.map((thing, i) => (
              <View key={thing.path}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Row
                  icon={<Icon name={thing.icon} />}
                  title={thing.title}
                  subtitle={thing.subtitle}
                  onPress={() => router.push(`/${thing.path}/${job.id}`)}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { color: colors.ink, fontSize: typography.size.md, padding: 16 },
  content: { padding: 16, gap: 16 },
  empty: { color: colors.inkBody, fontSize: typography.size.md, lineHeight: 24 },
  panel: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.lineRow, marginLeft: 56 },
});
