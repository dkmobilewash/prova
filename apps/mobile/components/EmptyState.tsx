import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/lib/icon-glyphs";
import { leadingFor, type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/** The "nothing here" state, with a way out phrased in the description. Big
 * enough to read at arm's length, so the person knows the screen is empty
 * rather than broken. `icon` and `action` are the redesign's additions —
 * a quiet glyph and one secondary button, never more; all existing copy is
 * unchanged. */
export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <View style={styles.wrap}>
      {icon ? <Icon name={icon} size={28} color={palette.colors.inkMuted} /> : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button variant="secondary" onPress={onAction}>
            {actionLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { alignItems: "center", padding: space.xxl, gap: space.xs },
    action: { marginTop: space.xs },
    title: {
      color: p.colors.ink,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
      textAlign: "center",
    },
    description: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      lineHeight: leadingFor(typography.size.md),
      textAlign: "center",
    },
  });
}
