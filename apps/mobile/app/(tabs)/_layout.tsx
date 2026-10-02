import { useMemo, useState } from "react";
import { Tabs } from "expo-router";
import { CaptureSheet } from "@/components/CaptureSheet";
import { FloatingCaptureButton } from "@/components/FloatingCaptureButton";
import { Icon } from "@/components/Icon";
import { holds } from "@/lib/capabilities";
import { useT } from "@/lib/i18n";
import { useCurrentJob } from "@/lib/use-current-job";
import { useMe } from "@/lib/use-me";
import { usePushRegistration } from "@/lib/use-push-registration";
import { typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * Five destinations plus one button — the whole of the app's top level.
 *
 *   Home     what today looks like on the job you are on
 *   Jobs     every job, and how you change which one you are on
 *   Alerts   what needs attention, across the company
 *   Outbox   what this phone has not managed to send yet
 *   Settings the account, the language, the reminder
 *   ＋        the capture sheet: Photo first, then everything a field day
 *            produces, filed against the CURRENT JOB
 *
 * ALERTS AND OUTBOX WERE HIDDEN DESTINATIONS UNTIL NOW, and promoting them
 * is a structural fix rather than a rearrangement. Alerts was reachable
 * only by tapping a push notification; Outbox only from a row inside
 * Settings. Both are things a person needs to be able to CHECK without
 * being prompted — "did my report actually send?" is the question a queue
 * exists to answer, and it was two taps inside a menu.
 *
 * Moving them into this group does NOT change their URLs. `(tabs)` is a
 * route group, so `/alerts` and `/outbox` are still `/alerts` and
 * `/outbox`: every `router.push` and the notification tap router
 * (lib/push-target.ts) keep working untouched.
 *
 * AND IT RETIRES THE COLD-START DEAD END ON /alerts STRUCTURALLY. That bug
 * — a notification tap from a killed app landing on a screen with no back
 * chevron and no tab bar — took four releases to fix (#548, #553, #554,
 * #555). A tab destination cannot have it: the bar is always rendered.
 * `WayHome` is therefore removed from Alerts and kept on `/job/[jobId]`,
 * which is still outside this group. See push-destination-exit.test.ts,
 * which now asserts exactly that split rather than one blanket rule.
 *
 * Create and Camera used to be tabs. They were doorways — the Create tab
 * was a launcher and the Camera tab redirected away the moment it was
 * focused — so one button opens the same actions in a sheet, and Photo
 * still opens the shutter directly (?open=camera). The button is gated by
 * MANAGE_FIELD: an estimator sees the tabs and no button.
 *
 * The queue's drain timer is NOT here: it lives in the root layout so it
 * keeps running during a handover, when the tabs are not mounted.
 */
export default function TabsLayout() {
  usePushRegistration();

  const palette = usePalette();
  const { t } = useT();
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
            title: t("nav.home"),
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
            title: t("nav.jobs"),
            // Jobs draws its own large title inside the safe area.
            headerShown: false,
            tabBarIcon: ({ color, focused }) => <Icon name="jobs" color={color} filled={focused} size={24} />,
          }}
        />
        <Tabs.Screen
          name="alerts"
          options={{
            title: t("nav.alerts"),
            // Alerts draws its own large title inside the safe area.
            headerShown: false,
            tabBarIcon: ({ color, focused }) => <Icon name="alert" color={color} filled={focused} size={24} />,
          }}
        />
        <Tabs.Screen
          name="outbox"
          options={{
            // `nav.tab.outbox`, NOT `nav.outbox`. A tab label and a screen
            // title are different things and this is the proof: "Waiting to
            // send" is a good large title on the screen itself, and in the
            // bar it rendered as "Waiting t…" on a real phone — a truncated
            // word is worse than a short one. The screen, the Settings row
            // and the section header all still say "Waiting to send".
            title: t("nav.tab.outbox"),
            headerShown: false,
            tabBarIcon: ({ color, focused }) => <Icon name="outbox" color={color} filled={focused} size={24} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t("settings.title"),
            // Settings draws its own large title inside the safe area.
            headerShown: false,
            tabBarIcon: ({ color, focused }) => <Icon name="settings" color={color} filled={focused} size={24} />,
          }}
        />
      </Tabs>
      {field ? <FloatingCaptureButton onPress={() => setCaptureOpen(true)} /> : null}
      <CaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} job={job} />
    </>
  );
}
