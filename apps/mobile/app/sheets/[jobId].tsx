import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { Card } from "@/components/Card";
import { JobContextChip } from "@/components/JobContextChip";
import { SyncStatus } from "@/components/SyncStatus";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { type Palette, hitTarget, hitTargetPrimary, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { saveQueued } from "@/lib/save-queued";
import { uuid } from "@/lib/id";
import { type HeldPin, isHeld as heldHas, pinCount, pinsOn, stillHeld } from "@/lib/sheet-pin-display";
import type { SheetRow } from "@/lib/types";

/**
 * A PLAN SHEET, ON THE PHONE, WITH PINS ON IT.
 *
 * `app/drawings/[jobId].tsx` says in its own header that "there are no SHEETS
 * in this product". That was true when it was written and is what this screen
 * changes: a revision's PDF is now rendered server-side into one image per
 * page, and a pin is a point on that page.
 *
 * **WHY AN IMAGE AND NOT THE PDF.** This app has no PDF renderer and no
 * WebView — `react-native-svg` is the only graphics dependency — so the sheet
 * is an `<Image>` with an SVG overlay for the marks. That choice is what keeps
 * the phone free of a new native module, and offline comes free because an
 * image caches like any other.
 *
 * **THE COORDINATES.** `x` is the tap divided by the rendered WIDTH, and so is
 * `y` — not the height. `x` runs 0..1 and `y` runs 0..H/W. One definition of
 * that box exists, in `apps/web/lib/sheet-geometry.ts`, and this screen must
 * not grow a second: the whole point is that a pin dropped here lands in the
 * same place on the web.
 *
 * **TWO LIMITS THIS VERSION HAS, WRITTEN DOWN RATHER THAN DISCOVERED ON A
 * LADDER.** There is no pinch-zoom: a D-size sheet at phone width is enough to
 * place a pin against a visible feature and NOT enough to read a dimension
 * string, and zoom needs a gesture library this app does not carry. And only a
 * NOTE pin can be PLACED here — a photo or punch pin needs a picker for what it
 * points at, which is its own screen. Pins of every kind are shown.
 */

const KIND_WORD: Record<string, string> = { PHOTO: "Photo", PUNCH: "Punch", NOTE: "Note" };

export default function SheetsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const p = usePalette();
  const { t } = useT();
  const { me } = useMe();
  const getToken = useStableGetToken();
  const s = useMemo(() => styles(p), [p]);

  const [sheets, setSheets] = useState<SheetRow[] | null>(null);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);
  const [index, setIndex] = useState(0);
  const [boxWidth, setBoxWidth] = useState(0);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  /** Pins this phone is holding. Drawn exactly like the real ones and listed
   * with a word saying they have not reached the office yet. Each carries the
   * page it belongs to, because the screen can be moved between sheets while
   * the queue is still full. */
  const [pending, setPending] = useState<HeldPin[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    const result = await cachedRead(
      cacheKeys.sheets(jobId),
      withToken(getToken, (token) => api.listSheets(jobId, token)),
    );
    if (result.from === "nothing") {
      setOffline("nothing");
      return;
    }
    setSheets(result.value);
    setOffline(staleNote(result));
    // Anything the office now has is no longer this phone's to hold. Matching
    // on the words rather than an id, because a queued pin has no server id
    // until it lands — and a pin left in both lists draws twice.
    setPending((held) => stillHeld(result.value, held));
  }, [getToken, jobId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (!holds(me, SCREEN_CAPABILITY["sheets/[jobId]"])) {
    return <NotYourJobFunction what={SCREEN_NOUN["sheets/[jobId]"]} />;
  }

  const sheet = sheets && sheets.length > 0 ? sheets[Math.min(index, sheets.length - 1)] : null;
  const aspect = sheet ? sheet.heightPt / sheet.widthPt : 1;
  /** What this sheet shows: what the office has, plus what this phone is still
   * holding. One list, so the overlay and the words below it cannot disagree
   * about how many pins are on the drawing. */
  const shown = sheet ? pinsOn(sheet, pending) : [];
  const isHeld = (id: string) => heldHas(id, pending);
  const countOn = (row: SheetRow) => pinCount(row, pending);

  async function placeNote() {
    if (!sheet || !draft) return;
    const words = note.trim();
    if (words.length === 0) {
      setProblem(t("sheets.noteNeeded"));
      return;
    }
    setSaving(true);

    // QUEUED, NOT SENT. A drawing is what somebody walks the building with,
    // and that walk happens in a basement or the middle of a slab. Calling the
    // API here would make a pin something you can only place where there is
    // signal, which is never where you are standing when you need one.
    //
    // Queued BEFORE the draft is cleared, for the reason lib/save-queued.ts
    // gives at length: nine submit functions cleared their form first and lost
    // the typed words when the write to disk threw.
    const saved = await saveQueued({
      type: "sheet-pin:create",
      jobId: String(jobId),
      pageId: sheet.id,
      clientOperationId: uuid(),
      x: draft.x,
      y: draft.y,
      kind: "NOTE",
      note: words,
    });
    setSaving(false);
    if (!saved.ok) {
      setProblem(saved.error);
      return;
    }
    // Cleared only now, with everything else, because it is on the far side of
    // the await -- write-ordering.test.ts counts a cleared error exactly as it
    // counts a cleared form, and it is right to: both are state a failed write
    // would have silently dropped.
    setProblem(null);

    // Shown straight away, because the queue may not drain for hours. A pin
    // that appeared only after a sync would mean tapping, typing, saving, and
    // watching the drawing not change — which reads as the app ignoring you.
    // `pending` marks it so the row can say it has not reached the office.
    setPending((existing) => [
      ...existing,
      {
        id: `pending-${Date.now()}`,
        pageId: sheet.id,
        x: draft.x,
        y: draft.y,
        kind: "NOTE",
        note: words,
        mediaId: null,
        punchItemId: null,
        punchItemDescription: null,
      },
    ]);
    setDraft(null);
    setNote("");
  }

  return (
    <ScrollView contentContainerStyle={s.page}>
      <JobContextChip />
      <SyncStatus state={offline} />

      {sheets === null ? null : sheets.length === 0 ? (
        // Through `emptyFor` so "no sheets on this job" and "this phone could
        // not reach the office" are different sentences. A screen that writes
        // its own empty state cannot tell those apart, and a foreman reads the
        // second as the first.
        ((empty) => (
          <Card>
            <Text style={s.empty}>{empty.emptyTitle}</Text>
            {empty.emptyDescription ? <Text style={s.body}>{empty.emptyDescription}</Text> : null}
          </Card>
        ))(emptyFor(offline, "thing.sheets", { title: "sheets.none", description: "sheets.noneDetail" }))
      ) : (
        <>
          {sheets.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
              {sheets.map((row, i) => (
                <Pressable
                  key={row.id}
                  onPress={() => {
                    setIndex(i);
                    setDraft(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i === index }}
                  style={[s.tab, i === index && s.tabOn]}
                >
                  <Text style={[s.tabText, i === index && s.tabTextOn]}>
                    {row.label ?? `${t("sheets.sheet")} ${row.pageNumber}`}
                    {countOn(row) > 0 ? ` (${countOn(row)})` : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {sheet && !sheet.imageUrl ? (
            <Card>
              {/* Said as what a foreman can and cannot do, not as a
                  processing state: this sheet is not usable on site yet. */}
              <Text style={s.empty}>{t("sheets.notReady")}</Text>
              <Text style={s.body}>{t("sheets.notReadyDetail")}</Text>
            </Card>
          ) : sheet && sheet.imageUrl ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("sheets.tapToPlace")}
                onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
                onPress={(e) => {
                  if (boxWidth === 0) return;
                  const { locationX, locationY } = e.nativeEvent;
                  // BOTH over the WIDTH. The line this screen turns on.
                  setDraft({ x: locationX / boxWidth, y: locationY / boxWidth });
                  setProblem(null);
                }}
                style={s.sheetBox}
              >
                <Image
                  source={{ uri: sheet.imageUrl }}
                  style={{ width: "100%", height: boxWidth * aspect }}
                  resizeMode="contain"
                  accessibilityLabel={`${sheet.setName} ${sheet.revisionLabel}`}
                />
                {boxWidth > 0 && (
                  <Svg
                    style={StyleSheet.absoluteFill}
                    width={boxWidth}
                    height={boxWidth * aspect}
                    pointerEvents="none"
                  >
                    {shown.map((pin) => (
                      <Circle
                        key={pin.id}
                        cx={pin.x * boxWidth}
                        cy={pin.y * boxWidth}
                        r={space.sm}
                        // A held pin is hollow: it is on the drawing, and it
                        // is not at the office yet. The row below says so in
                        // words — the ring alone is not the message.
                        fill={isHeld(pin.id) ? "none" : p.colors.brand}
                        stroke={p.colors.ink}
                        strokeWidth={space.two}
                      />
                    ))}
                    {draft && (
                      <>
                        <Line
                          x1={draft.x * boxWidth - space.md}
                          y1={draft.y * boxWidth}
                          x2={draft.x * boxWidth + space.md}
                          y2={draft.y * boxWidth}
                          stroke={p.colors.ink}
                          strokeWidth={space.two}
                        />
                        <Line
                          x1={draft.x * boxWidth}
                          y1={draft.y * boxWidth - space.md}
                          x2={draft.x * boxWidth}
                          y2={draft.y * boxWidth + space.md}
                          stroke={p.colors.ink}
                          strokeWidth={space.two}
                        />
                      </>
                    )}
                  </Svg>
                )}
              </Pressable>

              {/* The pins as WORDS. A mark on a drawing is a dot of colour and
                  nothing else; this is where it says which kind it is and what
                  it points at, which is the half a colour cannot carry. */}
              <Card>
                {shown.length === 0 ? (
                  <Text style={s.body}>{t("sheets.noPins")}</Text>
                ) : (
                  shown.map((pin) => (
                    <View key={pin.id} style={s.pinRow}>
                      <Text style={s.pinKind}>{KIND_WORD[pin.kind] ?? pin.kind}</Text>
                      <Text style={s.body}>
                        {pin.note ?? pin.punchItemDescription ?? t("sheets.pinGone")}
                        {isHeld(pin.id) ? ` · ${t("sheets.waiting")}` : ""}
                      </Text>
                    </View>
                  ))
                )}
              </Card>
            </>
          ) : null}
        </>
      )}

      {/* The place-a-note controls sit at the BOTTOM, because this phone is
          held in one hand and often on a ladder. */}
      {draft && (
        <Card>
          <Text style={s.label}>{t("sheets.noteLabel")}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("sheets.notePlaceholder")}
            placeholderTextColor={p.colors.inkMuted}
            inputMode="text"
            style={s.input}
          />
          {problem && <Text style={s.problem}>{problem}</Text>}
          <Pressable
            accessibilityRole="button"
            onPress={placeNote}
            disabled={saving}
            style={[s.primary, saving && s.primaryOff]}
          >
            <Text style={s.primaryText}>{saving ? t("sheets.placing") : t("sheets.place")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDraft(null);
              setProblem(null);
            }}
            style={s.secondary}
          >
            <Text style={s.secondaryText}>{t("sheets.cancel")}</Text>
          </Pressable>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = (p: Palette) =>
  StyleSheet.create({
    page: { padding: space.md, paddingBottom: space.scrollBottom, gap: space.sm },
    empty: { color: p.colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
    body: { color: p.colors.inkBody, fontSize: typography.size.md },
    label: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.medium },
    tabs: { gap: space.xs, paddingVertical: space.xxs },
    tab: {
      minHeight: hitTarget,
      justifyContent: "center",
      paddingHorizontal: space.controlX,
      borderRadius: radius.pill,
      borderWidth: space.one,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
    },
    tabOn: { backgroundColor: p.colors.brand, borderColor: p.colors.brand },
    tabText: { color: p.colors.inkBody, fontSize: typography.size.md },
    tabTextOn: { color: p.colors.brandInk, fontWeight: typography.weight.semibold },
    sheetBox: {
      borderRadius: radius.card,
      borderWidth: space.one,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
      overflow: "hidden",
    },
    pinRow: { flexDirection: "row", gap: space.xs, alignItems: "baseline", paddingVertical: space.xxs },
    pinKind: {
      color: p.colors.inkLabel,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
    input: {
      minHeight: hitTarget,
      borderRadius: radius.field,
      borderWidth: space.one,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.canvas,
      color: p.colors.ink,
      paddingHorizontal: space.sm,
      fontSize: typography.size.md,
    },
    problem: { color: p.colors.tagRoseInk, fontSize: typography.size.md },
    primary: {
      minHeight: hitTargetPrimary,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: radius.field,
      backgroundColor: p.colors.brand,
    },
    primaryOff: { opacity: 0.6 },
    primaryText: {
      color: p.colors.brandInk,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
    },
    secondary: { minHeight: hitTarget, justifyContent: "center", alignItems: "center" },
    secondaryText: { color: p.colors.link, fontSize: typography.size.md },
  });
