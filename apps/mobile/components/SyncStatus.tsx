import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GroupedList } from "@/components/GroupedList";
import { Icon } from "@/components/Icon";
import { describeOp } from "@/lib/outbox";
import type { RefusedOp } from "@/lib/sync-queue";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * The ONE place the app tells you about sync — where three visual
 * languages used to compete (a bare "Pending sync" line, the OfflineNote
 * sentences, a RefusedBanner card, plus a hand-rolled duplicate on the
 * punch list). One quiet group, every sentence preserved verbatim:
 *
 *   pending → "Pending sync: N"
 *   stale   → the cached-read staleNote sentence
 *   nothing → "Can't load this right now, and this phone hasn't loaded it
 *              before. Anything you add is kept and sent when you're back
 *              in range."
 *   refused → "N items weren't saved" + the server's words + Try again /
 *              Throw away
 *
 * Renders nothing when there is nothing to say — a screen with a green
 * queue shows no strip at all.
 */
export function SyncStatus({
  pending,
  state,
  refused,
  onDismiss,
  onRetry,
  refusedLine,
  dismissLabel,
  refusedTitle,
  maxRefused = 5,
}: {
  pending?: number;
  state?: string | "nothing" | null;
  refused?: RefusedOp[];
  onDismiss?: () => void;
  /** Puts them back on the queue — the reason may have been dealt with. */
  onRetry?: () => void;
  /** How one refused op is described. The default names the work the way
   * the outbox does; the punch list says only what the server said. */
  refusedLine?: (op: RefusedOp) => string;
  /** The dismissed count, in the caller's own words — "items" on the
   * banner, "changes" on the punch list, both pre-existing copy. */
  refusedTitle?: (count: number) => string;
  /** The dismiss action's word — "Throw away" on the banner, "Dismiss" on
   * the punch list, both pre-existing copy. */
  dismissLabel?: string;
  /** How many refused lines to show. */
  maxRefused?: number;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const rows: ReactNode[] = [];
  if (pending && pending > 0) {
    rows.push(
      <Row key="pending" icon="cloudDone" palette={palette}>
        <Text style={styles.line}>Pending sync: {pending}</Text>
      </Row>,
    );
  }
  if (state) {
    rows.push(
      <Row key="offline" icon="cloudOffline" palette={palette}>
        {state === "nothing" ? (
          <Text style={styles.body}>
            Can&apos;t load this right now, and this phone hasn&apos;t loaded it before. Anything you
            add is kept and sent when you&apos;re back in range.
          </Text>
        ) : (
          <Text style={styles.stale}>{state}</Text>
        )}
      </Row>,
    );
  }
  if (refused && refused.length > 0) {
    rows.push(
      <View key="refused" style={styles.refusedBlock}>
        <View style={styles.refusedTitleRow}>
          <Icon name="alert" size={22} color={palette.colors.tagRoseInk} />
          <Text style={styles.refusedTitle}>
            {refusedTitle
              ? refusedTitle(refused.length)
              : refused.length === 1
                ? "1 item wasn't saved"
                : `${refused.length} items weren't saved`}
          </Text>
        </View>
        {refused.slice(-maxRefused).map((r, i) => (
          <Text key={i} style={styles.line}>
            {refusedLine ? refusedLine(r) : `${describeOp(r.op).title} — ${r.error}`}
          </Text>
        ))}
        <View style={styles.actions}>
          {onRetry ? (
            <Pressable onPress={onRetry} style={styles.dismiss}>
              <Text style={styles.dismissLabel}>Try again</Text>
            </Pressable>
          ) : null}
          {onDismiss ? (
            <Pressable onPress={onDismiss} style={styles.dismiss}>
              <Text style={styles.dismissLabel}>{dismissLabel ?? "Throw away"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>,
    );
  }

  if (rows.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <GroupedList>{rows}</GroupedList>
    </View>
  );
}

function Row({ icon, children, palette }: { icon: "cloudDone" | "cloudOffline"; children: ReactNode; palette: Palette }) {
  return (
    <View style={rowStyles.row}>
      <Icon name={icon} size={22} color={palette.colors.inkMuted} />
      <View style={rowStyles.text}>{children}</View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  text: { flex: 1 },
});

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { marginHorizontal: space.md, marginTop: space.md, marginBottom: 0 },
    stale: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    body: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 20 },
    line: { color: p.colors.inkBody, fontSize: typography.size.sm },
    refusedBlock: {
      gap: space.xxs,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderTopWidth: 1,
      borderTopColor: p.colors.lineRow,
    },
    refusedTitleRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
    refusedTitle: {
      color: p.colors.tagRoseInk,
      fontSize: typography.size.md,
      fontWeight: typography.weight.bold,
    },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.xs, marginTop: space.xxs },
    dismiss: { paddingVertical: 4, paddingHorizontal: 8 },
    dismissLabel: {
      color: p.colors.link,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
  });
}
