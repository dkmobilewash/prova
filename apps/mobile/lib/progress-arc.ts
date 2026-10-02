/**
 * THE SWEEP IS THE VALUE. This is one line of maths in its own file
 * because of what it is replacing.
 *
 * The reference design's donut is a CSS circle with `border-left-color`
 * set to a second colour — one quarter of the ring, always, at every
 * percentage. It prints "58%" in the middle and draws the same shape at
 * 12% and 94%. That is decoration wearing a measurement's clothes, and
 * this repo has paid for that shape repeatedly.
 *
 * So the arc is derived, and it is derived HERE, where a plain-node test
 * can hold it to the claim. `react-native-svg` cannot be imported by the
 * lib suite and is mocked away in the screens suite, so a test that went
 * through a render could only ever assert that nothing threw.
 */
export function arcDash(
  value: number,
  size: number,
  stroke: number,
): { radius: number; circumference: number; filled: number; gap: number } {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * clamped;
  return { radius, circumference, filled, gap: circumference - filled };
}
