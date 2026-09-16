import { StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";

/** The "nothing here" state, with a way out phrased in the description. Big
 * enough to read at arm's length, so the person knows the screen is empty
 * rather than broken. */
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", padding: 32, gap: 8 },
  title: {
    color: colors.ink,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    textAlign: "center",
  },
  description: {
    color: colors.inkBody,
    fontSize: typography.size.md,
    lineHeight: typography.leading.normal,
    textAlign: "center",
  },
});
