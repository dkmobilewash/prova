import { StyleSheet, Text } from "react-native";
import { t } from "@/lib/i18n";
import { colors, typography } from "@/lib/theme";

/**
 * The one line every screen shows when what you are looking at came off
 * this phone rather than the server — and the sentence for the case where
 * nothing could be loaded at all.
 *
 * One component so eight screens cannot word it eight ways, and so the
 * distinction that matters keeps being drawn: "this is old" is not the
 * same as "this failed", and NEITHER is the same as "there is nothing
 * here", which is what the punch list said on a jobsite with no signal.
 */
export function OfflineNote({ state }: { state: string | "nothing" | null }) {
  if (!state) return null;
  if (state === "nothing") {
    return (
      <Text style={styles.nothing}>{t("offline.nothing")}</Text>
    );
  }
  return <Text style={styles.stale}>{state}</Text>;
}

const styles = StyleSheet.create({
  stale: { color: colors.inkMuted, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  nothing: { color: colors.inkBody, padding: 16, fontSize: typography.size.sm, lineHeight: 20 },
});
