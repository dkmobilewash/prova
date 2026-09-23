import { useAuth, useUser } from "@clerk/expo";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "@/components/Card";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { JobContextChip } from "@/components/JobContextChip";
import { SectionHeader } from "@/components/SectionHeader";
import { Skeleton } from "@/components/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { SyncStatus } from "@/components/SyncStatus";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, oldestNote, withToken, type CachedRead } from "@/lib/cached-read";
import { holds } from "@/lib/capabilities";
import { tokenOrNull } from "@/lib/clerk-token";
import { useT, type Language, type StringKey } from "@/lib/i18n";
import { localToday, shortDay } from "@/lib/local-today";
import { prefetchJob } from "@/lib/prefetch";
import { pendingCount } from "@/lib/sync-queue";
import { type Palette, radius, space, typography } from "@/lib/theme";
import { dayKey, summariseToday, todayKey, type TodayLine } from "@/lib/today";
import type { Job, Media } from "@/lib/types";
import { useCurrentJob } from "@/lib/use-current-job";
import { useMe } from "@/lib/use-me";
import { usePalette } from "@/lib/use-palette";
import { useStableGetToken } from "@/lib/use-stable-get-token";

/** Only the fallback below draws these now — see `longDate`. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function greetingKey(now: Date): StringKey {
  const hour = now.getHours();
  if (hour < 12) return "home.greeting.morning";
  if (hour < 18) return "home.greeting.afternoon";
  return "home.greeting.evening";
}

/**
 * "Saturday, September 21" — the phone's calendar day, not UTC's — and
 * "sábado, 21 de septiembre" on a phone in Spanish.
 *
 * The date is still BUILT at UTC midnight and formatted with
 * `timeZone: "UTC"`, which is the whole point of the `Date.UTC` above it:
 * `localToday()` has already decided which calendar day this is, and a
 * formatter left on the device's zone would be free to move it back a day.
 * The two halves have to agree or the greeting block contradicts the rest
 * of the screen.
 *
 * Wrapped because a runtime without full ICU throws on a locale it cannot
 * load, and Home is the screen the app opens on — an English date is a
 * blemish, a crash on launch is the app. `lib/i18n.ts` guards its own
 * `Intl` call for the same reason.
 */
function longDate(iso: string, language: Language): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  try {
    return new Intl.DateTimeFormat(language === "es" ? "es-MX" : "en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
  }
}

/**
 * Home: what today looks like on the job this phone is on — now a daily
 * command centre rather than a menu wearing a heading. The greeting says
 * when we are; the Today group says what is true and what needs doing,
 * each line a claim derived from real rows in lib/today.ts (which is pure
 * and tested, and hands this screen a translation key plus its numbers
 * rather than a finished sentence); one quiet card carries the job itself.
 *
 * Nothing here is new server work: the four lists are the same ones the
 * sections already load, and the job card reads the jobs list this phone
 * already caches.
 */
export default function HomeScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const getToken = useStableGetToken();
  const { job, loading } = useCurrentJob();
  // Home is four FIELD lists. Somebody who cannot read them must not be
  // told "today's report isn't filed" — that is a claim about a day, made
  // from four empty lists the server refused to send.
  const { me } = useMe();
  const field = holds(me, "MANAGE_FIELD");
  const { t, language } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [lines, setLines] = useState<TodayLine[]>([]);
  const [jobSummary, setJobSummary] = useState<Job | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!job || !field) return;

    // Through the cache, section by section, so Home offline shows the
    // day as this phone last knew it rather than a page of zeros —
    // "no photos today" is a claim, and it was wrong every time the
    // fetch failed. The token is fetched INSIDE each read: Clerk refreshes
    // it over the network, so a screen that bails on a null token never
    // reaches its own cache (see withToken).
    const [reports, punchItems, mediaRows, timeEntries, jobs] = await Promise.all([
      cachedRead(cacheKeys.reports(job.id), withToken(getToken, (t) => api.listFieldReports(job.id, t))),
      cachedRead(cacheKeys.punchList(job.id), withToken(getToken, (t) => api.listPunchListItems(job.id, t))),
      cachedRead(cacheKeys.photos(job.id), withToken(getToken, (t) => api.listMedia(job.id, t))),
      cachedRead(cacheKeys.time(job.id), withToken(getToken, (t) => api.listTimeEntries(job.id, t))),
      cachedRead(cacheKeys.jobs(), withToken(getToken, (t) => api.listJobs(t))),
    ]);
    const pending = await pendingCount();

    setMedia(rows(mediaRows));
    setJobSummary(rows(jobs).find((j) => j.id === job.id) ?? null);
    setLines(
      summariseToday({
        reports: rows(reports),
        punchItems: rows(punchItems),
        media: rows(mediaRows),
        timeEntries: rows(timeEntries),
        pending,
      }),
    );

    const sections = [reports, punchItems, mediaRows, timeEntries];
    // Stale beats missing beats fresh, in that order. A screen with ANY
    // old section on it says so — reporting the oldest of the four,
    // because Home is only as current as its stalest line.
    const stale = oldestNote(sections);
    if (stale) {
      setError(stale);
    } else if (sections.some((section) => section.from === "nothing")) {
      setError(t("home.offline.nothing"));
    } else {
      setError(null);
      // While there IS signal, fill the cache for the sections Home does
      // not itself read — Materials, Safety, T&M, drawings, schedule.
      // Home is the screen the app opens on, so this is the moment the
      // phone is most likely to still have bars; by the time somebody
      // opens Materials in a basement it is far too late to fetch it.
      void tokenOrNull(getToken).then((token) => {
        if (token) void prefetchJob(job.id, token, me);
      });
    }
    // `t` is the module-level function `useT` hands back, the same
    // reference on every render — it is in the list to satisfy the lint
    // rule, and it never re-creates this callback.
  }, [getToken, job, field, me, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!isLoaded) return <Text style={styles.loading}>{t("common.loading")}</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const today = todayKey();
  const todayPhotos = media.filter((item) => dayKey(item.capturedAt) === today);
  const dateRange =
    jobSummary?.startDate && jobSummary?.endDate
      ? `${shortDay(jobSummary.startDate)} – ${shortDay(jobSummary.endDate)}`
      : null;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={palette.colors.inkMuted}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={styles.greeting}>
          {t(greetingKey(new Date()))}
          {/* A person's name is never translated, and the comma before it
              is punctuation both languages already agree on. */}
          {user?.firstName ? `, ${user.firstName}` : ""}
        </Text>
        <Text style={styles.date}>{longDate(localToday(), language)}</Text>

        <View style={styles.chipRow}>
          <JobContextChip />
        </View>

        {loading && field ? (
          <View style={styles.skeletonGroup}>
            <Skeleton height={52} />
            <Skeleton height={52} />
            <Skeleton height={52} />
          </View>
        ) : !field ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("home.empty.notYours.title")}</Text>
            <Text style={styles.emptyBody}>{t("home.empty.notYours.body")}</Text>
          </View>
        ) : !job ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("home.empty.noJob.title")}</Text>
            <Text style={styles.emptyBody}>{t("home.empty.noJob.body")}</Text>
          </View>
        ) : (
          <>
            <SyncStatus state={error} />
            <SectionHeader>{t("home.today")}</SectionHeader>
            <GroupedList>
              {lines.map((line, i) => (
                <GroupedRow
                  key={line.key}
                  icon={toneIcon(line.tone, palette)}
                  title={t(line.label, line.vars)}
                  divider={i > 0}
                  onPress={
                    line.section
                      ? () => {
                          // The outbox is about this phone, not this job.
                          router.push(
                            line.section === "outbox" ? "/outbox" : `/${line.section}/${job.id}`,
                          );
                        }
                      : undefined
                  }
                />
              ))}
            </GroupedList>

            {jobSummary ? (
              <Card style={styles.jobCard}>
                <View style={styles.jobCardHead}>
                  <Text style={styles.jobCardName} numberOfLines={1}>
                    {jobSummary.name}
                  </Text>
                  <StatusBadge status={jobSummary.status} />
                </View>
                {dateRange ? <Text style={styles.jobCardMeta}>{dateRange}</Text> : null}
              </Card>
            ) : null}

            {todayPhotos.length > 0 ? (
              <View style={styles.stripRow}>
                {todayPhotos.slice(0, 4).map((photo) => (
                  <Thumb key={photo.id} uri={photo.blobUrl} jobId={job.id} />
                ))}
                {todayPhotos.length > 4 ? (
                  <Pressable
                    onPress={() => router.push(`/photos/${job.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={t("home.photos.all")}
                    style={styles.moreTile}
                  >
                    <Text style={styles.moreTileText}>+{todayPhotos.length - 4}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The state of each line, said in a glyph as well as in words — the words
 * are the message, the glyph is the glance. Done earns a checkmark, warn
 * an exclamation; todo and plain keep a quiet dot, which is all "not yet"
 * deserves. */
function toneIcon(tone: TodayLine["tone"], palette: Palette) {
  const styles = toneStyles(palette);
  switch (tone) {
    case "done":
      return <Icon name="checkCircle" size={20} color={palette.colors.barGreen} />;
    case "warn":
      return <Icon name="warning" size={20} color={palette.colors.barRose} />;
    case "todo":
      return <View style={[styles.dot, styles.dotTodo]} />;
    case "plain":
      return <View style={[styles.dot, styles.dotPlain]} />;
  }
}

/** One photo of today, at the strip's size — a glance that opens the
 * gallery when tapped. */
function Thumb({ uri, jobId }: { uri: string; jobId: string }) {
  const { t } = useT();
  return (
    <Pressable
      onPress={() => router.push(`/photos/${jobId}`)}
      accessibilityRole="button"
      accessibilityLabel={t("home.photos.open")}
      style={thumbStyles.tile}
    >
      <Image source={{ uri }} style={thumbStyles.thumb} resizeMode="cover" />
    </Pressable>
  );
}

const thumbStyles = StyleSheet.create({
  tile: { width: 72, height: 72, borderRadius: radius.field, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
});

/** An empty list is the honest answer when a section could not be loaded
 * at all — and the banner above says so, which is what stops
 * `summariseToday` turning that emptiness into "no photos today". */
function rows<T>(read: CachedRead<T[]>): T[] {
  return read.from === "nothing" ? [] : read.value;
}

function toneStyles(p: Palette) {
  return StyleSheet.create({
    dot: { width: 12, height: 12, borderRadius: radius.pill },
    dotTodo: { backgroundColor: p.colors.brand },
    dotPlain: { backgroundColor: p.colors.inkMuted },
  });
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    loading: { color: p.colors.ink, fontSize: typography.size.md, padding: space.md },
    content: { paddingHorizontal: space.md, paddingBottom: 88, gap: space.sm },
    greeting: {
      color: p.colors.ink,
      fontSize: typography.size.xl2,
      fontWeight: typography.weight.bold,
      marginTop: space.xs,
    },
    date: {
      color: p.colors.inkBody,
      fontSize: typography.size.sm,
    },
    chipRow: { marginTop: space.sm, marginBottom: space.xxs },
    skeletonGroup: { gap: space.sm, marginTop: space.md },
    empty: { gap: space.xs, paddingTop: space.xl },
    emptyTitle: {
      color: p.colors.ink,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
    },
    emptyBody: { color: p.colors.inkBody, fontSize: typography.size.sm, lineHeight: 22 },
    jobCard: { marginTop: space.sm, gap: space.xs },
    jobCardHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
    jobCardName: {
      color: p.colors.ink,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
      flex: 1,
    },
    jobCardMeta: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    stripRow: { flexDirection: "row", gap: space.xs, marginTop: space.sm },
    moreTile: {
      width: 72,
      height: 72,
      borderRadius: radius.field,
      backgroundColor: p.colors.surface,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      alignItems: "center",
      justifyContent: "center",
    },
    moreTileText: { color: p.colors.inkBody, fontSize: typography.size.sm },
  });
}
