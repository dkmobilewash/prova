import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";
import type { PendingOp, RefusedOp } from "@/lib/sync-queue";

function describe(op: PendingOp): string {
  switch (op.type) {
    case "time:create":
      return `${op.hours}h on ${op.date}`;
    case "signoff:create":
      return `Signature for ${op.date}`;
    case "delay:create":
      return `Delay on ${op.date}`;
    case "media:create":
      return `Photo from ${op.capturedAt.slice(0, 10)}`;
    case "field-report:create":
      return `Report for ${op.reportDate}`;
    case "ticket:create":
      return `T&M ticket for ${op.workDate}`;
    default:
      return "A saved item";
  }
}

/**
 * Writes the server refused for good and the queue set aside — a day that
 * was already signed, a crew member archived meanwhile. Without this they
 * would look saved on the phone and simply never appear.
 */
export function RefusedBanner({
  refused,
  onDismiss,
  onRetry,
}: {
  refused: RefusedOp[];
  onDismiss: () => void;
  /** Puts them back on the queue — the reason may have been dealt with. */
  onRetry?: () => void;
}) {
  if (refused.length === 0) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.title}>
        {refused.length === 1 ? "1 item wasn't saved" : `${refused.length} items weren't saved`}
      </Text>
      {refused.slice(-5).map((r, i) => (
        <Text key={i} style={styles.line}>
          {describe(r.op)} — {r.error}
        </Text>
      ))}
      <View style={styles.actions}>
        {onRetry ? (
          <Pressable onPress={onRetry} style={styles.dismiss}>
            <Text style={styles.dismissLabel}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onDismiss} style={styles.dismiss}>
          <Text style={styles.dismissLabel}>Throw away</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.tagRoseInk,
    gap: 4,
  },
  title: { color: colors.tagRoseInk, fontSize: typography.size.md, fontWeight: typography.weight.bold },
  line: { color: colors.inkBody, fontSize: typography.size.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  dismiss: { paddingVertical: 4, paddingHorizontal: 8 },
  dismissLabel: { color: colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
