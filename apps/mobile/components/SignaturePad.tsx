import { useEffect, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/lib/theme";

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
        {strokes.length === 0 ? <Text style={styles.placeholder}>Sign here</Text> : null}
        {strokes.flatMap((stroke, si) =>
          stroke.slice(1).map((p, i) => {
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
        <Text style={styles.clearLabel}>Clear</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  pad: {
    width: SIGNATURE_WIDTH,
    height: SIGNATURE_HEIGHT,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholder: { color: colors.inkMuted, fontSize: typography.size.md },
  segment: {
    position: "absolute",
    height: STROKE,
    borderRadius: STROKE / 2,
    backgroundColor: "#111111",
  },
  clear: { alignSelf: "flex-end", paddingHorizontal: 8, paddingVertical: 4 },
  clearLabel: { color: colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
