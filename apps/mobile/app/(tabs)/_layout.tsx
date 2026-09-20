import { Tabs } from "expo-router";
import { Text } from "react-native";
import { usePushRegistration } from "@/lib/use-push-registration";
import { colors, typography } from "@/lib/theme";

export default function TabsLayout() {
  usePushRegistration();

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
          title: "Jobs",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🏗️</Text>,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⋯</Text>,
        }}
      />
    </Tabs>
  );
}
