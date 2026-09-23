import { useColorScheme } from "react-native";
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
 */
export function usePalette(): Palette {
  const scheme = useColorScheme();
  return scheme === "dark" ? palettes.dark : palettes.light;
}
