import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * Which palette this phone draws in, and who decides.
 *
 * Three real answers and one deferral: `system` follows the OS (the
 * default, and what every phone did before this), while `light`, `dark`
 * and `outdoor` are the person saying they know better than the sensor.
 *
 * OUTDOOR IS NEVER AUTOMATIC, and that is the whole design. An ambient
 * light sensor cannot tell direct sun from a bright office, so an
 * auto-switch is wrong in both directions — and a theme that flips while
 * somebody is halfway through entering hours is worse than one they
 * chose. Diego's call, 2026-09-26.
 *
 * Same store shape as lib/i18n.ts, for the same reason: a module-level
 * subscription rather than a context, because the screens mount
 * standalone in the test harness and a missing provider would make every
 * one of them fail for a reason that has nothing to do with the test.
 */

const KEY = "prova.appearance";

export type Appearance = "system" | "light" | "dark" | "outdoor";

export const APPEARANCE_CHOICES: Appearance[] = ["system", "light", "dark", "outdoor"];

let choice: Appearance = "system";
const listeners = new Set<() => void>();

function publish() {
  for (const listener of [...listeners]) listener();
}

export async function loadAppearance(): Promise<void> {
  const saved = await AsyncStorage.getItem(KEY);
  choice = (APPEARANCE_CHOICES as string[]).includes(saved ?? "") ? (saved as Appearance) : "system";
  publish();
}

export async function setAppearance(next: Appearance): Promise<void> {
  choice = next;
  await AsyncStorage.setItem(KEY, next);
  publish();
}

export function currentAppearance(): Appearance {
  return choice;
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => choice,
    () => choice,
  );
}
