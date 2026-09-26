import { useColorScheme } from "react-native";
import { useAppearance } from "@/lib/appearance";
import { palettes, type Palette } from "@/lib/theme";

/**
 * The active palette, following the system appearance — no provider, on
 * purpose: screen tests mount screens standalone, and `useColorScheme` is
 * core React Native (returns "light" under react-native-web's defaults,
 * which is what tests render).
 *
 * Kept OUT of theme.ts deliberately: the lib test suite runs in plain
 * node, where importing react-native would fail resolution, and theme.ts
 * must stay importable there.
 *
 * The system appearance is now the DEFAULT rather than the only answer:
 * `outdoor` exists for direct sun and is chosen by hand in Settings
 * (lib/appearance.ts explains why it is never sensed).
 */
export function usePalette(): Palette {
  const scheme = useColorScheme();
  const appearance = useAppearance();
  if (appearance === "outdoor") return palettes.outdoor;
  if (appearance === "light") return palettes.light;
  if (appearance === "dark") return palettes.dark;
  return scheme === "dark" ? palettes.dark : palettes.light;
}
