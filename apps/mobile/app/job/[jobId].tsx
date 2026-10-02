import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { setCurrentJob } from "@/lib/current-job";
import { Icon } from "@/components/Icon";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { WayHome } from "@/components/wayHome";
import { SCREEN_CAPABILITY } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { cacheKeys } from "@/lib/cache-keys";
import { cacheGet } from "@/lib/offline-cache";
import { useMe } from "@/lib/use-me";
import type { IconName } from "@/lib/icon-glyphs";
import { shortDay } from "@/lib/local-today";
import { hitTarget, type Palette, radius, space, statusPair, typography } from "@/lib/theme";
import type { Job } from "@/lib/types";
import { usePalette } from "@/lib/use-palette";

// One tile per field feature, grouped the way a day groups them: the four
// things that happen on a site TODAY, then the records a job accumulates.
// Icon names are the app's own vocabulary and resolve in lib/icon-glyphs.ts
// — never a glyph name here.
//
// `count` names which cached section the tile's number comes from. It is
// the cache KEY's owner, not a new fetch — see `countsFromCache`.
const FEATURES = [
  { icon: "report", title: "Field reports", path: "reports", group: "day", count: "reports" },
  { icon: "photos", title: "Photos", path: "photos", group: "day", count: "photos" },
  { icon: "punch", title: "Punch list", path: "punch-list", group: "day", count: "punchList" },
  { icon: "time", title: "Time", path: "time", group: "day", count: "time" },
  { icon: "safety", title: "Safety", path: "safety", group: "records", count: "safety" },
  { icon: "materials", title: "Materials", path: "materials", group: "records", count: "materials" },
  { icon: "ticket", title: "T&M ticket", path: "ticket", group: "records", count: "tickets" },
  { icon: "drawings", title: "Drawings", path: "drawings", group: "records", count: "drawings" },
  { icon: "schedule", title: "Schedule", path: "schedule", group: "records", count: "schedule" },
] as const satisfies {
  icon: IconName;
  title: string;
  path: string;
  group: "day" | "records";
  count: CountKey;
}[];

const GROUPS: { key: "day" | "records"; title: string }[] = [
  { key: "day", title: "The day" },
  { key: "records", title: "Job records" },
];

type CountKey =
  | "reports" | "photos" | "punchList" | "time"
  | "safety" | "materials" | "tickets" | "drawings" | "schedule";

/** How many rows each cached section holds, or null for "this phone does
 * not know yet".
 *
 * NULL IS NOT ZERO AND THE DIFFERENCE IS THE WHOLE POINT. An empty cache
 * means the section has never reached this phone; rendering that as `0`
 * would be the app asserting "no photos on this job" on the strength of a
 * failed sync. Home already refuses that trade — "an empty list is the
 * honest answer when a section could not be loaded at all" — and a tile is
 * a louder place to get it wrong, because a number reads as a fact. A tile
 * with no cache shows no number at all. */
type Counts = Partial<Record<CountKey, number>>;

/** Two sections are objects rather than arrays, and both are counted by
 * what a person would count: orders they placed, and safety records
 * written. Vendors are a directory, not this job's activity. */
function sizeOf(key: CountKey, value: unknown): number | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") {
    const row = value as { orders?: unknown[]; talks?: unknown[]; incidents?: unknown[] };
    if (key === "materials") return row.orders?.length ?? null;
    if (key === "safety") return (row.talks?.length ?? 0) + (row.incidents?.length ?? 0);
  }
  return null;
}

/**
 * THE COUNTS COST NOTHING, WHICH IS WHY THIS SCREEN CAN HAVE THEM.
 *
 * `lib/prefetch.ts` already fills exactly these nine keys — it runs from
 * Home while there is still signal, precisely so a basement has the day's
 * work in it. This reads them back with `cacheGet` and makes no request of
 * its own, so the hub gained a number per tile without gaining an API call,
 * a hook or a line of business logic.
 */
async function countsFromCache(jobId: string): Promise<Counts> {
  const keys: [CountKey, string][] = [
    ["reports", cacheKeys.reports(jobId)],
    ["photos", cacheKeys.photos(jobId)],
    ["punchList", cacheKeys.punchList(jobId)],
    ["time", cacheKeys.time(jobId)],
    ["safety", cacheKeys.safety(jobId)],
    ["materials", cacheKeys.materials(jobId)],
    ["tickets", cacheKeys.tickets(jobId)],
    ["drawings", cacheKeys.drawings(jobId)],
    ["schedule", cacheKeys.schedule(jobId)],
  ];
  const out: Counts = {};
  await Promise.all(
    keys.map(async ([key, cacheKey]) => {
      const cached = await cacheGet<unknown>(cacheKey);
      const size = sizeOf(key, cached?.rows);
      if (size != null) out[key] = size;
    }),
  );
  return out;
}

/**
 * The hub for one job: what the job IS at a glance, then every field
 * feature as a tile carrying how much of it there is.
 *
 * WHY TILES WITH NUMBERS RATHER THAN NINE IDENTICAL ROWS. The previous
 * version listed the same nine features with a fixed description under
 * each — "Photos / Site photos and videos". That is a label, not
 * information: every row looked equally urgent, so the screen disclosed
 * nine doors and told you nothing about what was behind any of them. A
 * count is the smallest thing that makes a hub worth reading before
 * tapping, and it is what every mature field app puts here.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT SHOW: money. The reference
 * layouts lead with job value and balance due; this phone carries no
 * figures at all, by product rule, and `loadAlerts` already strips them
 * server-side per principal. The band and the Scheduled card are the
 * operational equivalents — what the job IS, and when it runs. Everything
 * else about it is a count, and counts belong on the tiles that open the
 * thing they count.
 *
 * There is no site address here either, and that is a data limit rather
 * than a choice: the phone's `Job` type is `{id, name, status, startDate,
 * endDate}`. Adding a location would need the API and the type to carry
 * one, which is a bigger change than a layout.
 */
export default function JobHubScreen() {
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId, name, status } = useLocalSearchParams<{
    jobId: string;
    name?: string;
    status?: string;
  }>();
  const [counts, setCounts] = useState<Counts>({});
  const [summary, setSummary] = useState<Job | null>(null);

  // Opening a job is how you choose one. The jobs list sets this too, but
  // a notification or a link lands here without passing through it, and
  // Home and the capture sheet would otherwise still be pointing at
  // whatever job you were on last week.
  useEffect(() => {
    if (jobId) void setCurrentJob({ id: jobId, name: name ?? "Job", status: status ?? null });
  }, [jobId, name, status]);

  // On focus rather than on mount: coming back from Photos having added
  // three should show three, and this is a cache read, not a request.
  useFocusEffect(
    useCallback(() => {
      if (!jobId) return;
      void (async () => {
        setCounts(await countsFromCache(jobId));
        // The dates live on the jobs list, which the Jobs tab keeps warm —
        // the same read Home does for its job card, and the same reason:
        // the route params carry a name and a status and nothing else.
        const jobs = await cacheGet<Job[]>(cacheKeys.jobs());
        setSummary(jobs?.rows.find((j) => j.id === jobId) ?? null);
      })();
    }, [jobId]),
  );

  // Only what this person can actually open. A tile that leads to a 403 is
  // worse than no tile: it reads as a broken app rather than as access
  // somebody else decides.
  const visible = FEATURES.filter((feature) =>
    holds(me, SCREEN_CAPABILITY[`${feature.path}/[jobId]`]),
  );

  const scheduled =
    summary?.startDate && summary?.endDate
      ? `${shortDay(summary.startDate)} – ${shortDay(summary.endDate)}`
      : summary?.startDate
        ? shortDay(summary.startDate)
        : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* First thing on the screen when a cold notification tap left no way
          off it. Renders nothing when there is a real back chevron. This
          route is still OUTSIDE (tabs), so unlike Alerts it has no tab bar
          to fall back on and genuinely needs this. */}
      <WayHome />

      <Text style={styles.name}>{name ?? "Job"}</Text>

      {/* The reference layout's full-width status band, which is the one
          thing on a job screen that should be readable without looking for
          it. The colour pair comes from `statusPair("job", …)` — the same
          source StatusBadge uses — so the band and any badge elsewhere on
          the screen physically cannot disagree about what a status means. */}
      {status ? <StatusBand status={status} /> : null}

      {/* WHERE THE REFERENCE PUTS JOB VALUE AND BALANCE DUE, this says WHEN
          the job runs — the one fact about a job that the grid below cannot
          express, since every tile there is a count.
          *
          * IT USED TO CARRY A SECOND FACT, "Punch items", AND A PHONE KILLED
          * IT. On a job with no dates the card collapsed to that one row and
          * read as a stray box — and the number was already on screen, in
          * the "Punch list" TILE eight points below it. A summary that
          * repeats a thing it is sitting next to is not a summary. Nothing
          * here could have caught that: happy-dom does no layout, so the
          * duplication was only visible once both were rendered together.
          *
          * So the card is one fact, and no dates means no card at all —
          * better than a box containing a dash. */}
      {scheduled ? (
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Scheduled</Text>
            <Text style={styles.factValue}>{scheduled}</Text>
          </View>
        </View>
      ) : null}

      {GROUPS.map((group) => {
        const tiles = visible.filter((feature) => feature.group === group.key);
        if (tiles.length === 0) return null;
        return (
          <View key={group.key}>
            <SectionHeader>{group.title}</SectionHeader>
            <View style={styles.grid}>
              {tiles.map((feature) => (
                <ActivityTile
                  key={feature.path}
                  icon={feature.icon}
                  title={feature.title}
                  count={counts[feature.count]}
                  onPress={() => router.push(`/${feature.path}/${jobId}`)}
                />
              ))}
            </View>
          </View>
        );
      })}

      {me && !holds(me, "MANAGE_FIELD") && !holds(me, "MANAGE_JOBS") ? (
        <Text style={styles.noneForYou}>
          Nothing on this job is part of your job function. The account owner sets who sees what, on
          the Team page.
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** The status, full width, in the pair its own domain already defines. */
function StatusBand({ status }: { status: string }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const pair = statusPair("job", status);
  return (
    <View style={[styles.band, { backgroundColor: palette.colors[pair.bg] }]}>
      <StatusBadge status={status} />
    </View>
  );
}

/**
 * One feature, as a half-width tile: glyph, name, and how much of it there
 * is. Two per row, so nine features fit in a glance instead of a scroll.
 *
 * The whole tile is the target and it clears `hitTarget` (48) by a wide
 * margin at this height — a gloved thumb on a ladder is the brief, and the
 * old full-width rows were the only thing this layout gives up. Nothing
 * here can measure that; it is a token and a phone, not a test.
 */
function ActivityTile({
  icon,
  title,
  count,
  onPress,
}: {
  icon: IconName;
  title: string;
  count: number | undefined;
  onPress: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The count is part of the name of the thing for a screen reader, or
      // it is a number floating beside a word.
      accessibilityLabel={count == null ? title : `${title}, ${count}`}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={styles.tileHead}>
        <Icon name={icon} size={22} color={palette.colors.inkBody} />
        {count == null ? null : <Text style={styles.tileCount}>{count}</Text>}
      </View>
      <Text style={styles.tileTitle} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    noneForYou: {
      color: p.colors.inkBody,
      fontSize: typography.size.sm,
      lineHeight: 22,
      paddingTop: space.sm,
    },
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: { padding: space.md, paddingBottom: space.xxl, gap: space.xs },
    name: {
      color: p.colors.ink,
      fontSize: typography.size.xl2,
      fontWeight: typography.weight.bold,
    },
    band: {
      borderRadius: radius.card,
      paddingVertical: space.sm,
      paddingHorizontal: space.sm,
      alignItems: "flex-start",
      marginTop: space.xxs,
    },
    facts: {
      flexDirection: "row",
      backgroundColor: p.colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      paddingVertical: space.sm,
      paddingHorizontal: space.sm,
      marginTop: space.xxs,
    },
    fact: { flex: 1, gap: space.xxs },
    factLabel: {
      color: p.colors.inkMuted,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
    },
    factValue: {
      color: p.colors.ink,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
    tile: {
      width: "48%",
      minHeight: hitTarget * 1.5,
      backgroundColor: p.colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      padding: space.sm,
      justifyContent: "space-between",
      gap: space.xs,
    },
    tilePressed: { backgroundColor: p.colors.rail },
    tileHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    tileCount: {
      color: p.colors.ink,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.bold,
    },
    tileTitle: {
      color: p.colors.ink,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
  });
}
