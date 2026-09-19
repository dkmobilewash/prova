import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useCallback, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { RefusedBanner } from "@/components/RefusedBanner";
import { Sheet } from "@/components/Sheet";
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
import { enqueue, queuedOperationIds } from "@/lib/sync-queue";
import { colors, typography } from "@/lib/theme";
import type { Media, MediaTag, PunchListItem } from "@/lib/types";
import { useReloadWhenShown } from "@/lib/use-reload-when-shown";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { useSync } from "@/lib/use-sync";

/** The photo is stamped at this width; the height follows the picture. Big
 * enough that the stamp is readable when a GC opens it full screen, small
 * enough to go up over a site connection. */
const STAMP_WIDTH = 1200;

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
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const getToken = useStableGetToken();
  const [media, setMedia] = useState<Media[]>([]);
  const [tags, setTags] = useState<MediaTag[]>([]);
  const [punchItems, setPunchItems] = useState<PunchListItem[]>([]);
  const [todaysReportId, setTodaysReportId] = useState<string | null>(null);
  const [jobName, setJobName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Photos taken on this phone that have not gone up yet.
  const [pending, setPending] = useState<{ clientOperationId: string; uri: string; capturedAt: string }[]>([]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    const today = dayFromClockIn(new Date().toISOString());
    await Promise.allSettled([
      api.listMedia(jobId, token).then(
        async (m) => {
          setMedia(m);
          setError(null);
          const queued = await queuedOperationIds();
          setPending((rows) => rows.filter((r) => queued.has(r.clientOperationId)));
        },
        (e) => setError(e instanceof Error ? e.message : "Failed to load photos"),
      ),
      api.listMediaTags(token).then(setTags, () => setTags([])),
      api.listPunchListItems(jobId, token).then(
        (items) => setPunchItems(items.filter((i) => !i.isDone)),
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
    ]);
  }, [getToken, jobId]);

  useReloadWhenShown(load);
  const { sync, refused, dismissRefused } = useSync(load);

  // The details sheet, opened once a photo has been taken or picked.
  const [shot, setShot] = useState<Shot | null>(null);
  const [caption, setCaption] = useState("");
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [attachReport, setAttachReport] = useState(true);
  const [punchItemId, setPunchItemId] = useState<string | null>(null);
  // ViewShot's own ref: `capture()` on it returns the stamped file's uri.
  const stampRef = useRef<ViewShotRef>(null);

  /** Where the phone is, read at the shutter. A refusal or a slow fix is not
   * an error: the photo is the point and the coordinate is the bonus, which
   * is the same rule the web capture path states. */
  const readLocation = async (): Promise<{ location: PhotoLocation | null; note: string | null }> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        return { location: null, note: "Location is off for C Stream, so this photo has no place on it." };
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
      return { location: null, note: "Couldn't get a location fix, so this photo has no place on it." };
    }
  };

  const afterPick = async (result: ImagePicker.ImagePickerResult, fallbackNow: Date) => {
    if (result.canceled) return;
    const asset = result.assets[0];
    setBusy("Reading location…");
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
      setError("The camera is off for C Stream. Turn it on in Settings to take site photos.");
      return;
    }
    const now = new Date();
    await afterPick(
      await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, exif: true }),
      now,
    );
  };

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
    setBusy("Stamping…");
    try {
      const capture = stampRef.current?.capture;
      if (!capture) throw new Error("The stamp could not be drawn. Try the photo again.");
      const stampedUri = await capture();
      const fileName = stampedFileName(shot.capturedAt);
      const kept = keepForUpload(stampedUri, fileName);
      const clientOperationId = uuid();
      setPending((rows) => [
        { clientOperationId, uri: kept, capturedAt: shot.capturedAt.toISOString() },
        ...rows,
      ]);
      await enqueue({
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
      setShot(null);
      setBusy(null);
      await sync();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Could not save that photo");
    }
  };

  const toggleTag = (id: string) =>
    setPickedTags((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]));

  const stampHeight = shot ? Math.round((shot.height / shot.width) * STAMP_WIDTH) : STAMP_WIDTH;
  const lines = shot ? stampLines({ jobName: jobName || "This job", capturedAt: shot.capturedAt, location: shot.location }) : [];

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <Text style={styles.busy}>{busy}</Text> : null}
      <RefusedBanner refused={refused} onDismiss={dismissRefused} />

      <List
        data={[
          ...pending.map((p) => ({ kind: "pending" as const, key: p.clientOperationId, uri: p.uri, capturedAt: p.capturedAt })),
          ...media.map((m) => ({ kind: "saved" as const, key: m.id, media: m })),
        ]}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.kind === "pending" ? (
            <Card>
              <Image source={{ uri: item.uri }} style={styles.photo} resizeMode="cover" />
              <Text style={styles.syncing}>Syncing…</Text>
              <Text style={styles.meta}>{item.capturedAt.slice(0, 10)}</Text>
            </Card>
          ) : (
            <Card>
              <Image source={{ uri: item.media.blobUrl }} style={styles.photo} resizeMode="cover" />
              {item.media.caption ? <Text style={styles.caption}>{item.media.caption}</Text> : null}
              <Text style={styles.meta}>{formatStampMoment(new Date(item.media.capturedAt))}</Text>
              <Text style={styles.meta}>
                {item.media.capturedLatitude !== null && item.media.capturedLongitude !== null
                  ? [
                      formatCoordinate({
                        latitude: item.media.capturedLatitude,
                        longitude: item.media.capturedLongitude,
                        accuracyMeters: item.media.capturedAccuracyMeters,
                      }),
                      formatAccuracy(item.media.capturedAccuracyMeters),
                    ]
                      .filter(Boolean)
                      .join("  ")
                  : "No location recorded"}
              </Text>
              {item.media.tags && item.media.tags.length > 0 ? (
                <Text style={styles.meta}>{item.media.tags.map((t) => t.name).join(" · ")}</Text>
              ) : null}
              {item.media.dailyFieldReportId ? <Text style={styles.attached}>On the day&rsquo;s report</Text> : null}
              {item.media.punchListItemId ? <Text style={styles.attached}>On a punch list item</Text> : null}
            </Card>
          )
        }
        emptyTitle="No photos yet"
        emptyDescription="Tap “Take photo”. Each one is stamped with the time and place it was taken, and goes up when there's signal."
      />

      <View style={[styles.footer, styles.footerRow]}>
        <Button variant="secondary" onPress={pickFromLibrary}>
          Library
        </Button>
        <View style={styles.footerMain}>
          <Button fullWidth onPress={takePhoto}>
            Take photo
          </Button>
        </View>
      </View>

      {/* The thing that gets captured: the picture with the stamp over it,
          rendered off-screen at full size. Off-screen rather than hidden —
          a view with display:none or zero opacity has nothing to capture. */}
      {shot ? (
        <View style={styles.offscreen} pointerEvents="none">
          <ViewShot ref={stampRef} style={{ width: STAMP_WIDTH, height: stampHeight }}>
            <Image source={{ uri: shot.uri }} style={{ width: STAMP_WIDTH, height: stampHeight }} resizeMode="cover" />
            <View style={styles.stamp}>
              {lines.map((line, i) => (
                <Text key={i} style={[styles.stampText, i === 0 && styles.stampTitle]}>
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
        title="Save photo"
        primaryLabel="Save photo"
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
                : (shot.locationNote ?? "No location recorded")}
            </Text>
            <Text style={styles.hint}>The time and place are burned into the photo when you save it.</Text>

            <Field label="Caption" placeholder="Optional" value={caption} onChangeText={setCaption} />

            {tags.length > 0 ? (
              <>
                <Text style={styles.label}>Tags</Text>
                <View style={styles.chips}>
                  {tags.map((t) => (
                    <Chip key={t.id} label={t.name} selected={pickedTags.includes(t.id)} onPress={() => toggleTag(t.id)} />
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>Attach to</Text>
            <View style={styles.chips}>
              <Chip
                label={todaysReportId ? "Today's report" : "No report today"}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  busy: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  photo: { width: "100%", height: 200, borderRadius: 8, backgroundColor: colors.lineCard },
  preview: { width: "100%", height: 220, borderRadius: 8, backgroundColor: colors.lineCard },
  caption: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 6 },
  meta: { color: colors.inkMuted, fontSize: typography.size.sm, marginTop: 2 },
  warn: { color: colors.tagRoseInk, fontSize: typography.size.sm, marginTop: 2 },
  attached: { color: colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold, marginTop: 2 },
  syncing: { color: colors.inkMuted, fontSize: typography.size.sm, fontStyle: "italic", marginTop: 6 },
  hint: { color: colors.inkMuted, fontSize: typography.size.sm },
  label: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
  footerRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  footerMain: { flex: 1 },
  offscreen: { position: "absolute", left: -10000, top: 0 },
  stamp: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  stampText: { color: "#ffffff", fontSize: 34, lineHeight: 44 },
  stampTitle: { fontWeight: "700" },
});
