import { useAuth } from "@clerk/expo";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { colors } from "@/lib/theme";

export default function MoreScreen() {
  const { signOut } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
      <Button variant="secondary" onPress={() => signOut()}>
        Sign out
      </Button>
    </View>
  );
}
