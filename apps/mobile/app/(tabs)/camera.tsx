import { useAuth } from "@clerk/expo";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CurrentJobBar } from "@/components/CurrentJobBar";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { colors, typography } from "@/lib/theme";
import { useCurrentJob } from "@/lib/use-current-job";

/**
 * The shutter, one tap from anywhere.
 *
 * The tab does not draw a camera of its own — it hands straight over to
 * the job's photo screen with `open=camera`, which is where the capture,
 * the GPS fix, the stamping and the upload queue already live. Two
 * implementations of that would be two implementations of the stamp.
 *
 * `router.replace`, not `push`: the tab is a doorway, and leaving the
 * photo screen should go back to whatever you were doing rather than to an
 * empty camera tab you have to leave twice.
 */
export default function CameraScreen() {
  const { me } = useMe();
  const { isLoaded, isSignedIn } = useAuth();
  const { job, loading } = useCurrentJob();

  useFocusEffect(
    useCallback(() => {
      if (job) router.replace(`/photos/${job.id}?open=camera`);
    }, [job]),
  );

  if (!isLoaded) return <Text style={styles.loading}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  if (!holds(me, "MANAGE_FIELD")) return <NotYourJobFunction what="Site photos" />;

  return (
    <View style={styles.screen}>
      <CurrentJobBar job={job} />
      {loading || job ? null : (
        <Text style={styles.empty}>
          Pick a job and the camera opens straight from this tab — a site photo is worth nothing
          filed against the wrong job.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { color: colors.ink, fontSize: typography.size.md, padding: 16 },
  empty: { color: colors.inkBody, fontSize: typography.size.md, lineHeight: 24, padding: 16 },
});
