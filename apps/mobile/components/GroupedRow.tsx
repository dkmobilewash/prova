import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { Icon } from "@/components/Icon";
import { type Palette, hitTarget, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * One row of a GroupedList, in the iOS settings idiom: icon slot, bold
 * title, quiet subtitle, optional trailing value, a real chevron icon —
 * and a pressed state that fills the cell (HIG cell highlight) instead of
 * fading it, because fading text is how a gloved thumb misses the answer.
 *
 * `divider` draws the hairline ABOVE this row, inset to the text edge —
 * pass it as `divider={i > 0}` the way the old panels did.
 */
export function GroupedRow({
  icon,
  title,
  titleStyle,
  subtitle,
  detail,
  note,
  value,
  trailing,
  children,
  onPress,
  chevron = true,
  divider = false,
  role,
  checked,
  accessibilityLabel,
}: {
  icon?: ReactNode;
  title: string;
  /** Overrides the title's type style — the punch list's strikethrough
   * on a verified item. */
  titleStyle?: StyleProp<TextStyle>;
  subtitle?: string;
  /** One quiet meta line under the subtitle — clock times, a revision. */
  detail?: string;
  /** One further line in body ink — a note, a description. */
  note?: string;
  value?: string;
  /** A right-side node BEFORE the chevron — the current-job checkmark,
   * a count pill. */
  trailing?: ReactNode;
  /** Anything rendered below the text — the punch list's photo prompt. */
  children?: ReactNode;
  onPress?: () => void;
  /** Chevron shows only when the row actually leads somewhere. */
  chevron?: boolean;
  divider?: boolean;
  /** "checkbox" for a row that toggles rather than navigates. */
  role?: "button" | "checkbox";
  checked?: boolean;
  accessibilityLabel?: string;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={role ?? (onPress ? "button" : undefined)}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={checked !== undefined ? { checked } : undefined}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
    >
      {divider ? <View style={styles.divider} /> : null}
      {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
      <View style={styles.text}>
        <Text style={[styles.title, titleStyle]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        {note ? (
          <Text style={styles.note} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
        {children}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {trailing}
      {chevron && onPress ? (
        <Icon name="chevron" size={18} color={palette.colors.inkMuted} />
      ) : null}
    </Pressable>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      minHeight: hitTarget,
      paddingVertical: 10,
      paddingHorizontal: space.md,
    },
    pressed: { backgroundColor: p.colors.railHover },
    divider: {
      position: "absolute",
      top: 0,
      left: 56, // icon slot (28) + gap (12) + padding (16) — the text edge
      right: 0,
      height: 1,
      backgroundColor: p.colors.lineRow,
    },
    iconSlot: {
      width: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    text: { flex: 1 },
    title: {
      color: p.colors.ink,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    subtitle: {
      color: p.colors.inkBody,
      fontSize: typography.size.sm,
      marginTop: 2,
    },
    detail: {
      color: p.colors.inkMuted,
      fontSize: typography.size.sm,
      marginTop: 1,
    },
    note: {
      color: p.colors.inkBody,
      fontSize: typography.size.sm,
      marginTop: 2,
    },
    value: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
    },
  });
}
