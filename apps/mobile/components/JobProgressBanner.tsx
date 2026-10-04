import { StyleSheet, Text, View } from "react-native";
import { ProgressRing } from "@/components/ProgressRing";
import { radius, space, typography, type Palette } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

/**
 * THE JOB HEADER BAND, and what replaced the money in it.
 *
 * The reference design leads this screen with `Job value $12,092.64` and
 * `Balance due $5,046.32` either side of a progress donut. This phone
 * carries no figures at all, by product rule — `loadAlerts` strips them
 * server-side per principal, and the hub's own comment says the same. So
 * the shape is kept and the content is operational: the ring is how much
 * of the punch list is VERIFIED, and the two flanking stats are the other
 * two states.
 *
 * Punch items have three states, not two, and the middle one is the point:
 * `lib/types.ts` says READY_FOR_REVIEW is "the one a foreman needs to
 * see" — we say it is fixed, nobody has checked yet. A band that showed
 * only open-vs-done would hide exactly the state somebody has to act on.
 *
 * INVERTED RATHER THAN BLACK. The reference hardcodes `#111111`, which on
 * our dark canvas (#0f0f0f) would be a card you cannot see. This paints
 * with `ink` on `surface`-coloured text — the palette's own inversion — so
 * it reads as a solid band in light, a bright band in dark, and true black
 * in outdoor, with no new tokens and no exception to theme-parity. The
 * text pair is the inverse of `ink on surface`, which theme-contrast
 * already holds at 7:1.
 */
export function JobProgressBanner({
  value,
  left,
  right,
}: {
  /** 0..1. **Never null**: "there is nothing to measure" is decided by the
   * CALLER, which renders no band at all — a job with no punch items has
   * not failed to close any, and a band saying so is still a box on a
   * screen that had nothing to report. This used to accept null and an
   * `empty` string, and neither could be reached: `punchBreakdown` returns
   * null with no rows, so the caller's own gate fired first and `total` was
   * never 0. Dead from the day it shipped. */
  value: number;
  left: { label: string; value: string };
  right: { label: string; value: string };
}) {
  const p = usePalette();
  const s = makeStyles(p);

  return (
    <View style={s.band}>
      <View style={s.stat}>
        <Text style={s.statLabel}>{left.label}</Text>
        <Text style={s.statValue}>{left.value}</Text>
      </View>
      <ProgressRing
        value={value}
        track={p.colors.inkMuted}
        arc={p.colors.brand}
        ink={p.colors.surface}
      />
      <View style={[s.stat, s.statRight]}>
        <Text style={s.statLabel}>{right.label}</Text>
        <Text style={s.statValue}>{right.value}</Text>
      </View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    band: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: space.sm,
      padding: space.md,
      borderRadius: radius.card,
      backgroundColor: p.colors.ink,
    },
    stat: { flex: 1, gap: 2 },
    statRight: { alignItems: "flex-end" },
    statLabel: {
      color: p.colors.surface,
      fontSize: typography.size.xs,
      // The label is quieter than its number, but it is still on an
      // inverted ground — opacity rather than a lighter token, so it can
      // never land on a colour the contrast census never checked.
      opacity: 0.75,
    },
    statValue: {
      color: p.colors.surface,
      fontSize: typography.size.lg,
      fontWeight: "700",
    },
  });
}
