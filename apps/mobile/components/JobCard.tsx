import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import type { IconName } from "@/lib/icon-glyphs";
import { cardSurface, hitTargetPrimary, radius, space, typography, type Palette } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * ONE JOB, AS A CARD — the reference design's job row: a tinted square
 * holding a glyph, the name, a quiet meta line, its status, and a chevron.
 *
 * NOT a `GroupedRow`. Two reasons, and the second is the real one. The
 * reference draws these as separate cards with air between them rather
 * than as one grouped slab, which is what makes a jobs list read as a
 * stack of things rather than a settings screen. And `GroupedRow`'s icon
 * slot is 28pt wide — the reference's mark is 37 — so fitting one in
 * would have widened the slot for every row in the app, including the
 * three on Home that hold a 10pt status dot.
 *
 * Depth is `cardSurface`, so this inherits the palette's decision rather
 * than making its own: hairline border in light and outdoor, shadow in
 * dark. See DESIGN.md, "Depth".
 *
 * WHAT THE REFERENCE HAS HERE THAT THIS DOES NOT: a `RC-1775 · Austin, TX`
 * meta line and a progress bar. Neither exists in this app's data — the
 * phone's `Job` is `{id, name, status, startDate, endDate}` and
 * `/api/v1/jobs` selects exactly those five. Inventing a number for the
 * bar would have made every card look informative and tell you nothing,
 * which is the same defect the reference's own fixed-geometry donut has.
 * `meta` carries what we DO have — the scheduled range, and whether this
 * is the job the phone is on.
 */
export function JobCard({
  name,
  status,
  meta,
  icon = "jobs",
  current = false,
  onPress,
}: {
  name: string;
  status: string;
  /** The scheduled range, "on this job", or nothing. */
  meta?: string;
  icon?: IconName;
  /** Marks the job this phone is currently on. */
  current?: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const s = makeStyles(p);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [s.card, pressed && s.pressed]}
    >
      <View style={s.tile}>
        <Icon name={icon} size={20} color={p.colors.ink} />
      </View>
      <View style={s.body}>
        <Text style={s.name} numberOfLines={2}>
          {name}
        </Text>
        {meta ? (
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <View style={s.statusRow}>
          <StatusBadge status={status} />
          {current ? <Icon name="checkCircle" size={16} color={p.colors.brand} /> : null}
        </View>
      </View>
      <Icon name="chevron" size={18} color={p.colors.inkMuted} />
    </Pressable>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    card: {
      ...cardSurface(p),
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      padding: space.sm,
      minHeight: hitTargetPrimary,
    },
    pressed: { backgroundColor: p.colors.railHover },
    tile: {
      width: 36,
      height: 36,
      borderRadius: radius.field,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: p.colors.tagBrandSoft,
    },
    body: { flex: 1, minWidth: 0, gap: space.xxs },
    name: {
      color: p.colors.ink,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    meta: { color: p.colors.inkBody, fontSize: typography.size.xs },
    statusRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  });
}
