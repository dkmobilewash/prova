import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, PixelRatio, StyleSheet, Text, View } from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { JobContextChip } from "@/components/JobContextChip";
import { Sheet } from "@/components/Sheet";
import { SyncStatus } from "@/components/SyncStatus";
import * as api from "@/lib/api";
import { dayFromClockIn } from "@/lib/clock-session";
import { uuid } from "@/lib/id";
import {
  capturedAtFromExif,
  formatAccuracy,
  formatCoordinate,
  formatStampMoment,
  roundCoordinate,
  stampLines,
  stampedFileName,
  type PhotoLocation,
} from "@/lib/photo-stamp";
import { keepForUpload } from "@/lib/photo-store";
import { saveQueued } from "@/lib/save-queued";
import { queuedOperationIds } from "@/lib/sync-queue";
import { JobSections } from "@/components/JobSections";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, requireToken, staleNote } from "@/lib/cached-read";
import { tokenOrNull } from "@/lib/clerk-token";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import type { Media, MediaTag, PunchListItem } from "@/lib/types";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { useSync } from "@/lib/use-sync";

/** The photo is stamped and stored at this width in PIXELS. Big enough that
 * the stamp is readable when a GC opens it full screen, small enough to go
 * up over a site connection.
 *
 * WHAT DECIDES THE OUTPUT SIZE is the rendered view's size in POINTS times
 * the screen's density — `ViewShot`'s own width/height options did nothing
 * here (measured on production: asked for 1200, stored 3600x4800, 3.6MB,
 * most of the platform's 4.5MB request cap). So the whole stamp layout is
 * laid out at `STAMP_WIDTH / density` points, and everything in it — the
 * padding, the type — is scaled by the same factor, which lands the capture
 * at STAMP_WIDTH pixels on any phone with the stamp the same size relative
 * to the picture. */
const STAMP_WIDTH = 1200;
/** Points per pixel on this screen: 1/3 on a 3x phone. */
const pointScale = () => 1 / PixelRatio.get();

type Shot = {
  uri: string;
  width: number;
  height: number;
  capturedAt: Date;
  location: PhotoLocation | null;
  /** Why there is no location, when there is none. */
  locationNote: string | null;
};

export default function PhotosScreen() {
  const { me } = useMe();
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  // `punchListItemId` arrives when the punch list sent us here to
  // photograph a specific fix, so the attachment is already chosen by the
  // time the sheet opens — the prompt that offered it would be a lie if it
  // dropped you on an empty picker.
  // `open=camera` arrives from the Camera tab, which is a doorway rather
  // than a screen of its own — the capture, the GPS fix, the stamping and
  // the upload queue all live here, and a second copy of that would be a
  // second copy of the stamp.
  const { jobId, punchListItemId, open } = useLocalSearchParams<{
    jobId: string;
    punchListItemId?: string;
    open?: string;
  }>();
  const getToken = useStableGetToken();
  const [media, setMedia] = useState<Media[]>([]);
  const [tags, setTags] = useState<MediaTag[]>([]);
  const [punchItems, setPunchItems] = useState<PunchListItem[]>([]);
  const [todaysReportId, setTodaysReportId] = useState<string | null>(null);
  const [jobName, setJobName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Photos taken on this phone that have not gone up yet.
  const [pending, setPending] = useState<{ clientOperationId: string; uri: string; capturedAt: string }[]>([]);

  const load = useCallback(async () => {
    if (!jobId) return;
    // ONE token for the whole screen, and a deadline on it: offline
    // `getToken()` takes about two and a half minutes to answer (see
    // lib/clerk-token.ts), and the cached rows below are exactly what
    // this screen is opened for when there is no signal.
    const token = await tokenOrNull(getToken);
    const today = dayFromClockIn(new Date().toISOString());
    await Promise.allSettled([
      // The ROWS are cached, not the pictures: a job's photos are tens of
      // megabytes, and what a foreman needs off-signal is which ones were
      // taken and when, not to re-view them on a 5-inch screen.
      cachedRead(cacheKeys.photos(jobId), requireToken(token, (t) => api.listMedia(jobId, t))).then(
        async (result) => {
          setError(null);
          if (result.from === "nothing") {
            setOffline("nothing");
            return;
          }
          setMedia(result.value);
          setOffline(staleNote(result));
          const queued = await queuedOperationIds();
          setPending((rows) => rows.filter((r) => queued.has(r.clientOperationId)));
        },
      ),
      // The rest are what the CAPTURE SHEET needs — tags, today's report,
      // the open punch items. Without a token there is nothing to ask,
      // and each already falls back to an empty list of its own.
      ...(token
        ? [
            api.listMediaTags(token).then(setTags, () => setTags([])),
            api.listPunchListItems(jobId, token).then(
              (items) => setPunchItems(items.filter((i) => i.status === "OPEN")),
              () => setPunchItems([]),
            ),
            api.listFieldReports(jobId, token).then(
              (rs) => setTodaysReportId(rs.find((r) => r.reportDate === today)?.id ?? null),
              () => setTodaysReportId(null),
            ),
            api.listJobs(token).then(
              (js) => setJobName(js.find((j) => j.id === jobId)?.name ?? ""),
              () => {},
            ),
          ]
        : []),
    ]);
  }, [getToken, jobId]);

  const { sync, refused, dismissRefused, retrySetAside } = useSync(load);

  // The details sheet, opened once a photo has been taken or picked.
  const [shot, setShot] = useState<Shot | null>(null);
  const [caption, setCaption] = useState("");
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [attachReport, setAttachReport] = useState(true);
  const [punchItemId, setPunchItemId] = useState<string | null>(punchListItemId ?? null);
  // ViewShot's own ref: `capture()` on it returns the stamped file's uri.
  const stampRef = useRef<ViewShotRef>(null);

  /** Where the phone is, read at the shutter. A refusal or a slow fix is not
   * an error: the photo is the point and the coordinate is the bonus, which
   * is the same rule the web capture path states. */
  const readLocation = async (): Promise<{ location: PhotoLocation | null; note: string | null }> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        return { location: null, note: t("photos.locationOff") };
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return {
        location: {
          latitude: roundCoordinate(fix.coords.latitude),
          longitude: roundCoordinate(fix.coords.longitude),
          accuracyMeters: fix.coords.accuracy ?? null,
        },
        note: null,
      };
    } catch {
      return { location: null, note: t("photos.locationFailed") };
    }
  };

  const afterPick = async (result: ImagePicker.ImagePickerResult, fallbackNow: Date) => {
    if (result.canceled) return;
    const asset = result.assets[0];
    setBusy(t("photos.busy.location"));
    const { location, note } = await readLocation();
    setBusy(null);
    setShot({
      uri: asset.uri,
      width: asset.width ?? STAMP_WIDTH,
      height: asset.height ?? STAMP_WIDTH,
      capturedAt: capturedAtFromExif(asset.exif as Record<string, unknown> | null, fallbackNow),
      location,
      locationNote: note,
    });
    setCaption("");
    setPickedTags([]);
    setPunchItemId(null);
    setAttachReport(true);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t("photos.cameraOff"));
      return;
    }
    const now = new Date();
    await afterPick(
      await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, exif: true }),
      now,
    );
  };

  /** Fires once per arrival from the Camera tab. A ref rather than a
   * dependency, because the shutter must not reopen when this screen
   * re-renders — which it does on every queue flush. */
  const cameraOpened = useRef(false);
  useEffect(() => {
    if (open !== "camera" || cameraOpened.current) return;
    cameraOpened.current = true;
    void takePhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickFromLibrary = async () => {
    await afterPick(
      await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, exif: true }),
      new Date(),
    );
  };

  /** Burns the stamp into the picture, keeps the stamped file where the
   * system will not clear it, and queues the upload. */
  const save = async () => {
    if (!shot || !jobId) return;
    setBusy(t("photos.busy.stamping"));
    try {
      const capture = stampRef.current?.capture;
      if (!capture) throw new Error(t("photos.stampFailed"));
      const stampedUri = await capture();
      const fileName = stampedFileName(shot.capturedAt);
      const kept = keepForUpload(stampedUri, fileName);
      const clientOperationId = uuid();
      setPending((rows) => [
        { clientOperationId, uri: kept, capturedAt: shot.capturedAt.toISOString() },
        ...rows,
      ]);
      const saved = await saveQueued({
        type: "media:create",
        jobId,
        clientOperationId,
        fileUri: kept,
        fileName,
        mimeType: "image/jpeg",
        capturedAt: shot.capturedAt.toISOString(),
        capturedLatitude: shot.location?.latitude,
        capturedLongitude: shot.location?.longitude,
        capturedAccuracyMeters: shot.location?.accuracyMeters ?? undefined,
        caption: caption.trim() || undefined,
        tagIds: pickedTags.length ? pickedTags : undefined,
        dailyFieldReportId: attachReport && todaysReportId ? todaysReportId : undefined,
        punchListItemId: punchItemId ?? undefined,
      });
      if (!saved.ok) {
        // Take the tile back off. It was added before the write and is a
        // picture claiming to be on its way to the office.
        setPending((rows) => rows.filter((r) => r.clientOperationId !== clientOperationId));
        setBusy(null);
        // saveQueued's wording, not the native error's: `e.message` here
        // would be raw AsyncStorage text.
        setError(saved.error);
        return;
      }
      setShot(null);
      setBusy(null);
      await sync();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : t("photos.saveFailed"));
    }
  };

  const toggleTag = (id: string) =>
    setPickedTags((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]));

  // In points, so the capture comes out at STAMP_WIDTH pixels.
  const layoutWidth = Math.round(STAMP_WIDTH * pointScale());
  const layoutHeight = shot ? Math.round((shot.height / shot.width) * layoutWidth) : layoutWidth;
  /** Points per stamp pixel: everything inside the stamp is written in the
   * pixel sizes it should come out at, then scaled by this. */
  const stampScale = layoutWidth / STAMP_WIDTH;
  const lines = shot ? stampLines({ jobName: jobName || "This job", capturedAt: shot.capturedAt, location: shot.location }) : [];

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["photos/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["photos/[jobId]"]} />;

  const empty = emptyFor(offline, "thing.photos", {
    title: "photos.empty.title",
    description: "photos.empty.body",
  });

  return (
    <View style={styles.screen}>
      <JobSections jobId={jobId} active="photos" />
      <View style={styles.chipWrap}>
        <JobContextChip />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SyncStatus state={offline} refused={refused} onDismiss={dismissRefused} onRetry={retrySetAside} />
      {busy ? <Text style={styles.busy}>{busy}</Text> : null}

      {/* The gallery as tiles, two-up: a photo is an object, not a list
          row, and a grid of them reads as the day's record at a glance.
          Time and place share one line; tags and attachments share the
          next — two facts to a line, never the old five-fact chain. */}
      <FlatList
        data={[
          ...pending.map((p) => ({ kind: "pending" as const, key: p.clientOperationId, uri: p.uri, capturedAt: p.capturedAt })),
          ...media.map((m) => ({ kind: "saved" as const, key: m.id, media: m })),
        ]}
        keyExtractor={(item) => item.key}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) =>
          item.kind === "pending" ? (
            <View style={styles.tile}>
              <Image source={{ uri: item.uri }} style={styles.tileImage} resizeMode="cover" />
              <View style={styles.tileBody}>
                <Text style={styles.syncing}>{t("common.syncing")}</Text>
                <Text style={styles.meta}>{item.capturedAt.slice(0, 10)}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.tile}>
              <Image source={{ uri: item.media.blobUrl }} style={styles.tileImage} resizeMode="cover" />
              <View style={styles.tileBody}>
                {item.media.caption ? (
                  <Text style={styles.caption} numberOfLines={1}>
                    {item.media.caption}
                  </Text>
                ) : null}
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    formatStampMoment(new Date(item.media.capturedAt)),
                    item.media.capturedLatitude !== null && item.media.capturedLongitude !== null
                      ? formatCoordinate({
                          latitude: item.media.capturedLatitude,
                          longitude: item.media.capturedLongitude,
                          accuracyMeters: item.media.capturedAccuracyMeters,
                        })
                      : t("photos.noLocation"),
                    item.media.capturedLatitude !== null ? formatAccuracy(item.media.capturedAccuracyMeters) : null,
                  ]
                    .filter(Boolean)
                    .join("  ")}
                </Text>
                {item.media.tags && item.media.tags.length > 0 ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.media.tags.map((t) => t.name).join(" · ")}
                  </Text>
                ) : null}
                {item.media.dailyFieldReportId || item.media.punchListItemId ? (
                  <Text style={styles.attached} numberOfLines={1}>
                    {[
                      item.media.dailyFieldReportId ? t("photos.onReport") : null,
                      item.media.punchListItemId ? t("photos.onPunchItem") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </View>
            </View>
          )
        }
        ListEmptyComponent={
          <EmptyState icon="photos" title={empty.emptyTitle} description={empty.emptyDescription} />
        }
      />

      <View style={[styles.footer, styles.footerRow]}>
        <Button variant="secondary" onPress={pickFromLibrary}>
          {t("photos.library")}
        </Button>
        <View style={styles.footerMain}>
          <Button fullWidth onPress={takePhoto}>
            {t("photos.take")}
          </Button>
        </View>
      </View>

      {/* The thing that gets captured: the picture with the stamp over it,
          rendered off-screen at full size. Off-screen rather than hidden —
          a view with display:none or zero opacity has nothing to capture. */}
      {shot ? (
        <View style={styles.offscreen} pointerEvents="none">
          <ViewShot
            ref={stampRef}
            options={{ format: "jpg", quality: 0.85 }}
            style={{ width: layoutWidth, height: layoutHeight }}
          >
            <Image source={{ uri: shot.uri }} style={{ width: layoutWidth, height: layoutHeight }} resizeMode="cover" />
            <View
              style={[
                styles.stamp,
                { paddingVertical: 18 * stampScale, paddingHorizontal: 24 * stampScale },
              ]}
            >
              {lines.map((line, i) => (
                <Text
                  key={i}
                  style={[
                    styles.stampText,
                    { fontSize: 34 * stampScale, lineHeight: 44 * stampScale },
                    i === 0 && styles.stampTitle,
                  ]}
                >
                  {line}
                </Text>
              ))}
            </View>
          </ViewShot>
        </View>
      ) : null}

      <Sheet
        visible={shot !== null}
        onClose={() => setShot(null)}
        title={t("photos.sheet.title")}
        primaryLabel={t("photos.sheet.save")}
        onPrimary={save}
        primaryDisabled={busy !== null}
      >
        {shot ? (
          <>
            <Image source={{ uri: shot.uri }} style={styles.preview} resizeMode="cover" />
            <Text style={styles.meta}>{formatStampMoment(shot.capturedAt)}</Text>
            <Text style={shot.location ? styles.meta : styles.warn}>
              {shot.location
                ? [formatCoordinate(shot.location), formatAccuracy(shot.location.accuracyMeters)].filter(Boolean).join("  ")
                : (shot.locationNote ?? t("photos.noLocation"))}
            </Text>
            <Text style={styles.hint}>{t("photos.stamped")}</Text>

            <Field
              label={t("photos.caption")}
              placeholder={t("common.optional")}
              value={caption}
              onChangeText={setCaption}
            />

            {tags.length > 0 ? (
              <>
                <Text style={styles.label}>{t("photos.tags")}</Text>
                <View style={styles.chips}>
                  {tags.map((t) => (
                    <Chip key={t.id} label={t.name} selected={pickedTags.includes(t.id)} onPress={() => toggleTag(t.id)} />
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>{t("photos.attachTo")}</Text>
            <View style={styles.chips}>
              <Chip
                label={todaysReportId ? t("photos.todaysReport") : t("photos.noReportToday")}
                selected={attachReport && todaysReportId !== null}
                onPress={() => todaysReportId && setAttachReport((a) => !a)}
              />
              {punchItems.map((item) => (
                <Chip
                  key={item.id}
                  label={item.description.length > 28 ? `${item.description.slice(0, 27)}…` : item.description}
                  selected={punchItemId === item.id}
                  onPress={() => setPunchItemId((current) => (current === item.id ? null : item.id))}
                />
              ))}
            </View>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    error: { color: p.colors.tagRoseInk, padding: space.md, paddingBottom: 0, fontSize: typography.size.sm },
    busy: {
      color: p.colors.link,
      padding: space.md,
      paddingBottom: 0,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
    column: { gap: space.sm },
    grid: { padding: space.md, gap: space.sm },
    tile: {
      flex: 1,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      borderRadius: radius.card,
      backgroundColor: p.colors.surface,
      overflow: "hidden",
    },
    tileImage: { width: "100%", aspectRatio: 1, backgroundColor: p.colors.lineCard },
    tileBody: { padding: 10, gap: space.one },
    preview: { width: "100%", height: 220, borderRadius: radius.small, backgroundColor: p.colors.lineCard },
    caption: { color: p.colors.inkBody, fontSize: typography.size.sm, marginTop: 2 },
    meta: { color: p.colors.inkMuted, fontSize: typography.size.xs, marginTop: 2 },
    warn: { color: p.colors.tagRoseInk, fontSize: typography.size.sm, marginTop: 2 },
    attached: {
      color: p.colors.link,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
      marginTop: 2,
    },
    syncing: { color: p.colors.inkMuted, fontSize: typography.size.sm, fontStyle: "italic", marginTop: 2 },
    hint: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    label: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    footer: { padding: space.md, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
    footerRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    footerMain: { flex: 1 },
    offscreen: { position: "absolute", left: -10000, top: 0 },
    stamp: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    stampText: { color: "#ffffff" },
    stampTitle: { fontWeight: "700" },
  });
}
