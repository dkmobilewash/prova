import { useAuth } from "@clerk/expo";
import { Pressable, Text, View } from "react-native";

export default function MoreScreen() {
  const { signOut } = useAuth();

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Pressable
        onPress={() => signOut()}
        style={{ backgroundColor: "#111", borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: "#fff", textAlign: "center" }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
