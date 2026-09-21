import { Tabs } from "expo-router";
import { usePushRegistration } from "@/lib/use-push-registration";
import { useQueueDrain } from "@/lib/use-queue-drain";
import { Icon } from "@/components/Icon";
import { colors, typography } from "@/lib/theme";

/**
 * Five tabs, which is the iOS ceiling before the bar starts collapsing
 * into "More" — and the five are chosen so a foreman's whole day is one
 * tap from anywhere:
 *
 *   Home     what today looks like on the job you are on
 *   Jobs     every job, and how you change which one you are on
 *   Create   the things you make on site, without hunting for a screen
 *   Camera   the shutter, because a photo happens while you are holding
 *            something in the other hand
 *   Settings the account
 *
 * Create and Camera act on the CURRENT JOB (lib/current-job.ts). Without
 * that they would each need a job picker first, which is two taps and a
 * scroll before the camera opens — on a phone held in one hand, in the
 * rain, that is the difference between a photo and no photo.
 */
export default function TabsLayout() {
  usePushRegistration();
  // One timer for the app: the queue retries itself while Prova is open,
  // rather than only when a screen happens to be focused.
  useQueueDrain();

  return (
    <Tabs
      screenOptions={{
        // The tab bar is chrome, so it takes the rail rather than the
        // canvas, with a hairline above it instead of the default
        // translucent blur — which read as a grey smear over a dark page.
        tabBarStyle: {
          backgroundColor: colors.rail,
          borderTopColor: colors.lineCard,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
        headerStyle: { backgroundColor: colors.rail },
        headerTintColor: colors.brand,
        headerTitleStyle: {
          color: colors.ink,
          fontSize: typography.size.md,
          fontWeight: typography.weight.semibold,
        },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
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
        name="create"
        options={{
          title: "Create",
          tabBarIcon: ({ color, focused }) => <Icon name="create" color={color} filled={focused} size={24} />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Camera",
          tabBarIcon: ({ color, focused }) => <Icon name="camera" color={color} filled={focused} size={24} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => <Icon name="settings" color={color} filled={focused} size={24} />,
        }}
      />
    </Tabs>
  );
}
