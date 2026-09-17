import { Tabs } from "expo-router";
import { Text } from "react-native";
import { usePushRegistration } from "@/lib/use-push-registration";

export default function TabsLayout() {
  usePushRegistration();

  return (
    <Tabs>
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
