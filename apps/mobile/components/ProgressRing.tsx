import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { arcDash } from "@/lib/progress-arc";
import { typography } from "@/lib/theme";

/**
 * A REAL ARC. The reference design's donut is a CSS circle with
 * `border-left-color` set to a second colour — three sides one colour, one
 * side another — with the number printed in the middle. It draws
 * identically at 12% and at 94%, which makes it decoration wearing a
 * measurement's clothes. This file exists because that is exactly the
 * failure this repo keeps paying for: something that looks right and means
 * nothing.
 *
 * So the sweep is `value`. A ring at 58% covers 58% of the circumference,
 * and a screenshot of it is evidence.
 *
 * `value` is 0..1, or **null for "there is nothing to measure"** — which is
 * not the same as zero and must not render as an empty ring. A job with no
 * punch items has not failed to close any; it has none to close. The
 * caller decides what to show instead.
 */
export function ProgressRing({
  value,
  size = 58,
  stroke = 8,
  track,
  arc,
  ink,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  /** The unfilled remainder. */
  track: string;
  /** The filled sweep. */
  arc: string;
  /** The centred label's colour. */
  ink: string;
  /** Overrides the default percentage text. */
  label?: string;
}) {
  const { radius: r, filled, gap } = arcDash(value, size, stroke);
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {/* NOTHING VERIFIED DRAWS NOTHING. `strokeLinecap="round"` paints a
            round cap even on a zero-length arc, so at 0% the ring showed a
            yellow dot at twelve o'clock — a mark that reads as "a little
            bit done" when the truth is none. Seen on a phone against a job
            with one open item; happy-dom does no layout, so nothing here
            could have rendered it to find out. */}
        {filled > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={arc}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${gap}`}
            // Start at twelve o'clock rather than three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <Text
        style={{
          color: ink,
          fontSize: typography.size.xs,
          fontWeight: "700",
        }}
        // The ring is decorative to a screen reader; the number carries it.
        accessibilityRole="text"
      >
        {label ?? `${Math.round(clamped * 100)}%`}
      </Text>
    </View>
  );
}
