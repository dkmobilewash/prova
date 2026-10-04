import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/lib/icon-glyphs";
import { hitTarget, radius, space, typography, type Palette } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * THE FOUR-UP ROW UNDER THE HEADER, from the reference design: a tinted
 * rounded tile with a dark glyph, and a bold label under it.
 *
 * The reference's four are mock labels — "Create project", "Users &
 * groups". Ours are the four things that happen on a site TODAY, which is
 * the same set the job hub groups as `day` and the capture sheet lists
 * first: photo, field report, time, punch item. A quick action that opens
 * a directory is not quick; it is a tab.
 *
 * The reference tints each tile a different colour (blue / violet / orange
 * / green). The monochrome theme it ships with collapses all four to one
 * yellow, and that is the one we take: four colours here would be four
 * meanings nobody assigned, on a row where the icon already says what the
 * thing is. Status colour is spent on status.
 *
 * Labels wrap to two lines on purpose — "Reporte diario" does not fit one
 * at a quarter of a phone, and the reference wraps its own ("Create\n
 * project") rather than shrinking the type.
 */
export function QuickActions({
  items,
}: {
  items: { icon: IconName; label: string; onPress: () => void }[];
}) {
  const p = usePalette();
  const s = makeStyles(p);

  return (
    <View style={s.row}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          style={({ pressed }) => [s.item, pressed && s.pressed]}
        >
          <View style={s.tile}>
            <Icon name={item.icon} size={22} color={p.colors.ink} />
          </View>
          <Text style={s.label} numberOfLines={2}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: space.xs },
    item: { flex: 1, alignItems: "center", gap: space.six, minHeight: hitTarget },
    pressed: { opacity: 0.6 },
    tile: {
      width: 56,
      height: 56,
      borderRadius: radius.card,
      alignItems: "center",
      justifyContent: "center",
      // The soft brand ground, not the brand fill: this is a row of FOUR,
      // and the palette's rule is at most one brand fill per screen.
      backgroundColor: p.colors.tagBrandSoft,
    },
    label: {
      color: p.colors.inkLabel,
      fontSize: typography.size.xs,
      fontWeight: "600",
      textAlign: "center",
    },
  });
}
