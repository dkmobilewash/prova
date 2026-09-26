import { useEffect, useMemo, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useT } from "@/lib/i18n";
import { type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";

type Point = { x: number; y: number };

export const SIGNATURE_WIDTH = 320;
export const SIGNATURE_HEIGHT = 160;
const STROKE = 2.5;
/** Points closer than this are dropped — keeps the path short and the
 * rendered segment count small without changing how the signature looks. */
const MIN_STEP = 2;

/**
 * The strokes as an SVG path in one fixed shape: `M<x> <y>` to start a
 * stroke, `L<x> <y>` to continue it, whole pixels on a 320x160 box. The
 * server accepts exactly this shape and nothing else, so a signature can
 * never carry markup into the web page that renders it. Null when empty.
 */
export function strokesToPath(strokes: Point[][]): string | null {
  const parts: string[] = [];
  const point = (p: Point) =>
    `${Math.max(0, Math.min(SIGNATURE_WIDTH, Math.round(p.x)))} ${Math.max(0, Math.min(SIGNATURE_HEIGHT, Math.round(p.y)))}`;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    stroke.forEach((p, i) => parts.push(`${i === 0 ? "M" : "L"}${point(p)}`));
    // A tap with no movement still leaves a mark: a zero-length line.
    if (stroke.length === 1) parts.push(`L${point(stroke[0])}`);
  }
  return parts.length > 0 ? parts.join("") : null;
}

/**
 * A drawn signature, in plain React Native — no canvas or SVG library, so
 * the installed dev client runs it without a rebuild. Each pair of points is
 * drawn as a short rotated bar.
 *
 * It lives inside scrolling sheets, so it claims the gesture on touch-down
 * and refuses to hand it back: a downward stroke is a signature, not a
 * scroll.
 */
export function SignaturePad({ onChange }: { onChange: (path: string | null) => void }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { t } = useT();
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [drawing, setDrawing] = useState(false);

  // The parent hears about the signature when a stroke ENDS, not on every
  // finger movement — otherwise the whole screen re-renders mid-stroke.
  useEffect(() => {
    if (!drawing) onChange(strokesToPath(strokes));
  }, [drawing, strokes, onChange]);

  // Built once, from state setters only (which never change), so nothing is
  // read from a ref or a prop while rendering.
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        setDrawing(true);
        setStrokes((s) => [...s, [p]]);
      },
      onPanResponderMove: (e) => {
        const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        setStrokes((s) => {
          const stroke = s[s.length - 1] ?? [];
          const last = stroke[stroke.length - 1];
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return s;
          return [...s.slice(0, -1), [...stroke, p]];
        });
      },
      onPanResponderRelease: () => setDrawing(false),
      onPanResponderTerminate: () => setDrawing(false),
    }),
  );

  const clear = () => setStrokes([]);

  return (
    <View style={styles.wrap}>
      <View style={styles.pad} {...responder.panHandlers}>
        {/* pointerEvents none: otherwise the first touch lands on this text
            and its locationX/Y are measured from the TEXT, not the pad, so
            the first stroke starts in the wrong place. */}
        {strokes.length === 0 ? (
          <Text pointerEvents="none" style={styles.placeholder}>
            {t("signature.here")}
          </Text>
        ) : null}
        {strokes.flatMap((stroke, si) =>
          // A tap, or the dot of an "i": one point and no segment to draw,
          // so it gets a round dot. The path already records it (a
          // zero-length line), so without this the signature would hold a
          // mark the signer never saw.
          stroke.length === 1
            ? [
                <View
                  key={`${si}-dot`}
                  pointerEvents="none"
                  style={[styles.dot, { left: stroke[0].x - STROKE, top: stroke[0].y - STROKE }]}
                />,
              ]
            : stroke.slice(1).map((p, i) => {
            const a = stroke[i];
            const dx = p.x - a.x;
            const dy = p.y - a.y;
            const length = Math.max(Math.hypot(dx, dy), STROKE);
            return (
              <View
                key={`${si}-${i}`}
                pointerEvents="none"
                style={[
                  styles.segment,
                  {
                    width: length,
                    left: (a.x + p.x) / 2 - length / 2,
                    top: (a.y + p.y) / 2 - STROKE / 2,
                    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                  },
                ]}
              />
            );
          }),
        )}
      </View>
      <Pressable onPress={clear} style={styles.clear}>
        <Text style={styles.clearLabel}>{t("signature.clear")}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    wrap: { gap: space.six },
    pad: {
      width: SIGNATURE_WIDTH,
      height: SIGNATURE_HEIGHT,
      alignSelf: "center",
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      borderRadius: radius.small,
      // Paper stays paper in both palettes — a signature must look like a
      // signature, which is why these two literals are the census's
      // whitelisted ones.
      backgroundColor: "#ffffff",
      overflow: "hidden",
      justifyContent: "center",
      alignItems: "center",
    },
    placeholder: { color: p.colors.inkMuted, fontSize: typography.size.md },
    dot: {
      position: "absolute",
      width: STROKE * 2,
      height: STROKE * 2,
      borderRadius: STROKE,
      backgroundColor: "#111111",
    },
    segment: {
      position: "absolute",
      height: STROKE,
      borderRadius: STROKE / 2,
      backgroundColor: "#111111",
    },
    // Left, not right: the app-wide floating Tools button sits over the
    // bottom-right of a sheet and covered a right-aligned Clear.
    clear: { alignSelf: "flex-start", paddingHorizontal: space.xs, paddingVertical: space.xxs },
    clearLabel: { color: p.colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  });
}
