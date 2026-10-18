import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
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
  /** The sheet on the whole screen, where a pin can actually be put somewhere.
   *
   * A D-size sheet is 42in wide. Inline it renders at about 350pt, so a gloved
   * fingertip (±8-10pt) is roughly 1.2in of paper — which at 1/8in = 1ft is
   * TEN FEET in the building. That locates a room, not a wall, and a foreman
   * who is handed a ten-foot circle twice stops using the feature. Zoom is
   * what makes a pin worth placing at all. */
  const [full, setFull] = useState(false);
  const window = useWindowDimensions();
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const scroller = useRef<ScrollView | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  /** Pins this phone is holding. Drawn exactly like the real ones and listed
   * with a word saying they have not reached the office yet. Each carries the
   * page it belongs to, because the screen can be moved between sheets while
   * the queue is still full. */
  const [pending, setPending] = useState<HeldPin[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  /** ONE DEFINITION OF THE TAP, used by the inline sheet and the full-screen
   * one. Two copies is how the two surfaces would start disagreeing about
   * where a pin goes, and a pin that lands somewhere else is worse than no
   * pin.
   *
   * BOTH axes over the WIDTH — `y` runs 0..H/W, not 0..1. The line this whole
   * feature turns on. */
  const place = useCallback((locationX: number, locationY: number, width: number) => {
    if (width === 0) return;
    setDraft({ x: locationX / width, y: locationY / width });
    setProblem(null);
  }, []);

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
    // THE KEYBOARD COVERED THE NOTE FIELD, AND MY FIRST FIX FOR IT DID
    // NOTHING AT ALL.
    //
    // #645 wrapped this screen in a `KeyboardAvoidingView` with
    // `behavior="padding"`, the pattern `app/sign-in.tsx` uses. On a real
    // phone, on build 15, the content did not move by a single pixel — the
    // note card and its Place button stayed under the keyboard, exactly as
    // before. The census passed the whole time, which is the limit of a
    // presence census and not a surprise: it can say the code is there, never
    // that the framework honours it.
    //
    // A KeyboardAvoidingView inside a navigator is the fragile arrangement
    // here. It measures the keyboard against the window while its own frame
    // starts below the header, so it needs a `keyboardVerticalOffset` nobody
    // can state from inside this file — and sign-in, where it does work, is a
    // screen with no header at all.
    //
    // `automaticallyAdjustKeyboardInsets` is the iOS-native answer and needs
    // none of that: UIScrollView adjusts its own contentInset for the keyboard
    // and scrolls the first responder into view. Verified to exist in the
    // installed react-native 0.86.3 rather than assumed —
    // `Libraries/Components/ScrollView/ScrollView.js:190`.
    <>
      <ScrollView
        ref={scroller}
        contentContainerStyle={s.page}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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
                onPress={(e) => place(e.nativeEvent.locationX, e.nativeEvent.locationY, boxWidth)}
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

                {/* THE ACCURACY DOOR. Inline, a tap on a D-size sheet is about
                    ten feet in the building; full screen and zoomed it becomes
                    about a foot. The label says so rather than leaving somebody
                    to find out by being wrong twice. */}
                <Pressable accessibilityRole="button" onPress={() => setFull(true)} style={s.openFull}>
                  <Text style={s.openFullText}>{t("sheets.openFull")}</Text>
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
            // Lifting the view is not the same as showing the field: this card is
            // the last thing on a long screen, so it can be clear of the keyboard
            // and still below the fold. The delay is the keyboard's own animation —
            // scrolling before it has opened scrolls to the wrong place.
            onFocus={() => {
              // 400ms, not 120: the inset arrives with the keyboard's own
              // animation (~250ms), and scrolling before it lands scrolls to
              // the OLD end — which is the covered position. The native inset
              // brings the FIELD into view by itself; this is for the Place
              // button below it, which first-responder scrolling does not
              // promise.
              setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 400);
            }}
            placeholder={t("sheets.notePlaceholder")}
            placeholderTextColor={p.colors.inkMuted}
            inputMode="text"
            style={s.input}
          />
          {problem && <Text style={s.problem}>{problem}</Text>}
          {/* THE FIELD ACT, above the note field on purpose: a foreman at the
              wall has not written anything yet, he has SEEN something. The
              camera opens with this point carried into it -- the same way the
              punch list already opens it with an item -- and the photo is
              pinned at the shutter. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (!draft || !sheet) return;
              router.push(
                `/photos/${jobId}?sheetPageId=${sheet.id}&pinX=${draft.x}&pinY=${draft.y}&open=1`,
              );
              setDraft(null);
              setProblem(null);
            }}
            style={s.secondary}
          >
            <Text style={s.secondaryText}>{t("sheets.photoHere")}</Text>
          </Pressable>
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

      {/* THE SHEET ON THE WHOLE SCREEN, PINCHABLE.

          WHY A MODAL AND NOT A NESTED SCROLLVIEW. The page is already a
          vertical ScrollView; a zoomable one inside it is same-axis nesting,
          and the pan then belongs to whichever wins. A Modal has no parent
          scroll view, so there is nothing to fight — and the drawing gets the
          whole screen, which is most of the accuracy win on its own: inline it
          is ~250pt tall, here it is the display.

          NO NEW DEPENDENCY. iOS ScrollView zooms natively via
          maximumZoomScale. gesture-handler and reanimated are both on disk as
          transitive deps and neither is needed — PressableScale.tsx made the
          same call for the same reason.

          THE ONE THING TO CHECK ON A DEVICE: locationX is expected to arrive
          in the content view's OWN coordinate space, unaffected by the zoom
          transform, which is what makes place() correct at any zoom with no
          maths. That is how UIScrollView zoom works, and no test here can see
          it — happy-dom has no layout and no pinch. If a pin lands elsewhere
          when zoomed, this is where to look, and the fix is to divide by
          width * zoomScale instead. */}
      <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)}>
        <View style={s.fullScreen}>
          <ScrollView
            maximumZoomScale={8}
            minimumZoomScale={1}
            bouncesZoom
            centerContent
            contentContainerStyle={s.fullContent}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            {sheet?.imageUrl ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("sheets.tapToPlace")}
                onPress={(e) => place(e.nativeEvent.locationX, e.nativeEvent.locationY, window.width)}
              >
                <Image
                  source={{ uri: sheet.imageUrl }}
                  style={{ width: window.width, height: window.width * aspect }}
                  resizeMode="contain"
                />
                <Svg
                  style={StyleSheet.absoluteFill}
                  width={window.width}
                  height={window.width * aspect}
                  pointerEvents="none"
                >
                  {shown.map((pin) => (
                    <Circle
                      key={pin.id}
                      cx={pin.x * window.width}
                      cy={pin.y * window.width}
                      r={space.sm}
                      fill={isHeld(pin.id) ? "none" : p.colors.brand}
                      stroke={p.colors.ink}
                      strokeWidth={space.two}
                    />
                  ))}
                  {draft ? (
                    <Circle
                      cx={draft.x * window.width}
                      cy={draft.y * window.width}
                      r={space.sm}
                      fill="none"
                      stroke={p.colors.ink}
                      strokeWidth={space.two}
                    />
                  ) : null}
                </Svg>
              </Pressable>
            ) : null}
          </ScrollView>

          {/* Bottom third, per the field rules: held one-handed, often on a
              ladder. */}
          <View style={s.fullBar}>
            <Text style={s.fullHint}>{t("sheets.fullHint")}</Text>
            <Pressable accessibilityRole="button" onPress={() => setFull(false)} style={s.primary}>
              <Text style={s.primaryText}>{t("sheets.closeFull")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = (p: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    openFull: { minHeight: hitTarget, justifyContent: "center", alignItems: "center" },
    openFullText: { color: p.colors.link, fontSize: typography.size.md },
    fullScreen: { flex: 1, backgroundColor: p.colors.canvas },
    fullContent: { flexGrow: 1, justifyContent: "center" },
    fullBar: { padding: space.md, gap: space.sm, backgroundColor: p.colors.surface },
    fullHint: { color: p.colors.inkBody, fontSize: typography.size.sm, textAlign: "center" },
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
