import { useAuth, useUser } from "@clerk/expo";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { CurrentJobBar } from "@/components/CurrentJobBar";
import { colors, typography } from "@/lib/theme";
import { clearCurrentJob } from "@/lib/current-job";
import { useCurrentJob } from "@/lib/use-current-job";

/** The account, and the one piece of app state worth being able to clear
 * by hand: which job the phone thinks it is on. */
export default function SettingsScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { job } = useCurrentJob();

  return (
    <View style={styles.screen}>
      <CurrentJobBar job={job} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>
            {user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "—"}
          </Text>
        </View>

        {job ? (
          <Button variant="secondary" onPress={() => clearCurrentJob()}>
            Leave {job.name}
          </Button>
        ) : null}

        <Button variant="secondary" onPress={() => signOut()}>
          Sign out
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 16 },
  panel: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 4,
  },
  label: { color: colors.inkMuted, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  value: { color: colors.ink, fontSize: typography.size.md },
});
