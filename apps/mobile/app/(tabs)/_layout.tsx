import { useMemo, useState } from "react";
import { Tabs } from "expo-router";
import { CaptureSheet } from "@/components/CaptureSheet";
import { FloatingCaptureButton } from "@/components/FloatingCaptureButton";
import { Icon } from "@/components/Icon";
import { holds } from "@/lib/capabilities";
import { useCurrentJob } from "@/lib/use-current-job";
import { useMe } from "@/lib/use-me";
import { usePushRegistration } from "@/lib/use-push-registration";
import { typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * Three destinations plus one button — the whole of the app's top level.
 *
 *   Home     what today looks like on the job you are on
 *   Jobs     every job, and how you change which one you are on
 *   More     the account, the outbox, the reminder
 *   ＋        the capture sheet: Photo first, then everything a field day
 *            produces, filed against the CURRENT JOB
 *
 * Create and Camera used to be tabs. They were doorways — the Create tab
 * was a launcher and the Camera tab redirected away the moment it was
 * focused — and two of five slots for doorways is how a foreman's thumb
 * gets a busy bar. One button opens the same actions in a sheet, and
 * Photo still opens the shutter directly (?open=camera), so a photo stays
 * two taps from anywhere. The button is gated by MANAGE_FIELD exactly as
 * the old tabs were: an estimator sees three tabs and no button.
 *
 * The queue's drain timer is NOT here: it lives in the root layout so it
 * keeps running during a handover, when the tabs are not mounted.
 */
export default function TabsLayout() {
  usePushRegistration();

  const palette = usePalette();
  const { me } = useMe();
  const { job } = useCurrentJob();
  const field = holds(me, "MANAGE_FIELD");
  const [captureOpen, setCaptureOpen] = useState(false);

  const screenOptions = useMemo(
    () => ({
      // The tab bar is chrome, so it takes the rail rather than the
      // canvas, with a hairline above it instead of the default
      // translucent blur — which read as a grey smear over a dark page.
      tabBarStyle: {
        backgroundColor: palette.colors.rail,
        borderTopColor: palette.colors.lineCard,
        borderTopWidth: 1,
      },
      tabBarActiveTintColor: palette.colors.brand,
      tabBarInactiveTintColor: palette.colors.inkMuted,
      tabBarLabelStyle: { fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
      headerStyle: { backgroundColor: palette.colors.rail },
      headerTintColor: palette.colors.brand,
      headerTitleStyle: {
        color: palette.colors.ink,
        fontSize: typography.size.md,
        fontWeight: typography.weight.semibold,
      },
      headerShadowVisible: false,
      sceneStyle: { backgroundColor: palette.colors.canvas },
    }),
    [palette],
  );

  return (
    <>
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            // Home draws its own greeting block inside the safe area — a
            // static header above "Good morning" is chrome between the
            // person and the day.
            headerShown: false,
            tabBarIcon: ({ color, focused }) => <Icon name="home" color={color} filled={focused} size={24} />,
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            title: "Jobs",
            tabBarIcon: ({ color, focused }) => <Icon name="jobs" color={color} filled={focused} size={24} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "More",
            tabBarIcon: ({ color, focused }) => <Icon name="more" color={color} filled={focused} size={24} />,
          }}
        />
      </Tabs>
      {field ? <FloatingCaptureButton onPress={() => setCaptureOpen(true)} /> : null}
      <CaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} job={job} />
    </>
  );
}
