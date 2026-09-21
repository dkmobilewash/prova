import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";
import { describeOp } from "@/lib/outbox";
import type { PendingOp, RefusedOp } from "@/lib/sync-queue";

/** One wording for a queued write, shared with the outbox — a second copy
 * here is how "A saved item" happened: this file's own switch had a
 * `default` that swallowed half the op types, so a refused punch item or
 * material order was shown to somebody as "A saved item" with no way to
 * tell which. `describeOp` is exhaustive by type, so a new op type is a
 * compile error rather than a blank line. */
function describe(op: PendingOp): string {
  const { title, detail } = describeOp(op);
  return detail ? `${title} — ${detail}` : title;
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
