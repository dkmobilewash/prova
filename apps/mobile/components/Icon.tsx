import Ionicons from "@expo/vector-icons/Ionicons";
import type { ColorValue } from "react-native";
import { colors } from "@/lib/theme";
import { ICON_GLYPHS, type IconName } from "@/lib/icon-glyphs";

/**
 * The app's icons. The names and the reasoning live in lib/icon-glyphs.ts;
 * this is the drawing half.
 *
 * `icon-names.test.ts` fails the build on a glyph the font does not carry,
 * because a misspelt name renders an empty box and says nothing — no
 * throw, no warning, and nothing a typecheck can see.
 */
export function Icon({
  name,
  size = 22,
  color = colors.inkBody,
  filled = false,
}: {
  name: IconName;
  size?: number;
  /** Defaults to body ink so an icon never out-shouts the label beside it.
   * A tab passes the tint the bar gives it. */
  color?: ColorValue;
  filled?: boolean;
}) {
  const [outline, solid] = ICON_GLYPHS[name];
  return <Ionicons name={filled ? solid : outline} size={size} color={color} />;
}

export type { IconName };
