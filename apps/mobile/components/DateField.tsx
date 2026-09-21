import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chip } from "@/components/Chip";
import { Icon } from "@/components/Icon";
import { type Palette, hitTarget, radius, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** yyyy-mm-dd <-> parts, all as the calendar day with no time zone: these
 * are days worked, stored at UTC midnight on the server. */
function parse(text: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function format(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The day before `text`, as yyyy-mm-dd. */
export function dayBefore(text: string): string {
  const p = parse(text);
  if (!p) return text;
  const date = new Date(Date.UTC(p.y, p.m, p.d - 1));
  return format(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** "Thu, Sep 18, 2026" — built by hand rather than toLocaleDateString, whose
 * output depends on the phone's settings and time zone. */
export function dayLabel(text: string): string {
  const p = parse(text);
  if (!p) return text;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  return `${weekday}, ${MONTHS[p.m].slice(0, 3)} ${p.d}, ${p.y}`;
}

/**
 * A day, picked rather than typed. Today and Yesterday are one tap — they
 * are nearly every entry — and the calendar is there for anything older.
 *
 * Pure React Native on purpose: a native date picker is a native module, and
 * the installed dev client would need a rebuild to carry one. Days after
 * `max` (today) cannot be picked: hours are logged for a day that happened.
 */
export function DateField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The latest pickable day, yyyy-mm-dd — the phone's today. */
  max: string;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const limit = parse(max);
  const [month, setMonth] = useState(() => {
    const start = selected ?? limit ?? { y: 2026, m: 0, d: 1 };
    return { y: start.y, m: start.m };
  });

  const yesterday = dayBefore(max);
  const firstWeekday = new Date(Date.UTC(month.y, month.m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const atLimitMonth = limit !== null && (month.y > limit.y || (month.y === limit.y && month.m >= limit.m));

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(month.y, month.m + delta, 1));
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };

  const pick = (text: string) => {
    onChange(text);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        <Chip label="Today" selected={value === max} onPress={() => pick(max)} />
        <Chip label="Yesterday" selected={value === yesterday} onPress={() => pick(yesterday)} />
        <Chip
          label={value === max || value === yesterday || !selected ? "Other day…" : dayLabel(value)}
          selected={open || (!!selected && value !== max && value !== yesterday)}
          onPress={() => {
            if (selected) setMonth({ y: selected.y, m: selected.m });
            setOpen((o) => !o);
          }}
        />
      </View>
      {selected ? <Text style={styles.picked}>{dayLabel(value)}</Text> : null}

      {open ? (
        <View style={styles.calendar}>
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => shift(-1)}
              style={styles.arrow}
              accessibilityLabel="Previous month"
            >
              <Icon name="chevronBack" size={20} color={palette.colors.link} />
            </Pressable>
            <Text style={styles.monthTitle}>
              {MONTHS[month.m]} {month.y}
            </Text>
            <Pressable
              onPress={() => shift(1)}
              disabled={atLimitMonth}
              style={[styles.arrow, atLimitMonth && styles.disabled]}
              accessibilityLabel="Next month"
            >
              <Icon name="chevron" size={20} color={palette.colors.link} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {WEEKDAYS.map((w, i) => (
              <Text key={`w${i}`} style={[styles.cell, styles.weekday]}>
                {w}
              </Text>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <View key={`e${i}`} style={styles.cell} />;
              const text = format(month.y, month.m, day);
              const future = text > max;
              const isSelected = text === value;
              return (
                <Pressable
                  key={text}
                  disabled={future}
                  onPress={() => pick(text)}
                  style={[styles.cell, isSelected && styles.selectedCell]}
                  accessibilityLabel={dayLabel(text)}
                >
                  <Text style={[styles.dayText, future && styles.futureText, isSelected && styles.selectedText]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { gap: 6 },
    label: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    picked: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    calendar: { borderWidth: 1, borderColor: p.colors.lineCard, borderRadius: radius.card, padding: 8 },
    monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
    monthTitle: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    arrow: { width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" },
    disabled: { opacity: 0.3 },
    grid: { flexDirection: "row", flexWrap: "wrap" },
    cell: { width: `${100 / 7}%`, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
    weekday: { color: p.colors.inkMuted, fontSize: typography.size.sm, textAlign: "center", lineHeight: 38 },
    dayText: { color: p.colors.ink, fontSize: typography.size.md },
    futureText: { color: p.colors.inkMuted, opacity: 0.4 },
    selectedCell: { backgroundColor: p.colors.ink },
    selectedText: { color: p.colors.canvas, fontWeight: typography.weight.bold },
  });
}
