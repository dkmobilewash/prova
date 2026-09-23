import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { EN } from "./strings/en";
import { ES } from "./strings/es";

/**
 * The app in the language of the person holding the phone.
 *
 * The case this is for is the teardown's C15/D-13 again: most hangers and
 * tapers do not carry a company phone, and a great many of them do not
 * work in English. An app that only speaks English is one a foreman has
 * to translate out loud, line by line, while somebody is standing there
 * with a taping knife in their hand — and "log your hours" is the one
 * task the phone exists to hand over.
 *
 * THE DEVICE'S OWN LANGUAGE COMES FIRST. If the phone is set to Spanish,
 * the app opens in Spanish with nothing to find and nothing to tap: a
 * setting somebody has to discover is a setting that does not exist. The
 * explicit choice in Settings is for the other cases — a shared phone, a
 * foreman who reads English but whose crew does not.
 *
 * Scoped ON PURPOSE to the field screens (see `TRANSLATED` in
 * strings-census.test.ts). Translating the office half would be a larger
 * job with a worse ratio, and half-translating a screen is worse than
 * leaving it: a Spanish sentence next to an English one reads as a bug.
 */

export type Language = "en" | "es";
export type LanguageChoice = Language | "auto";

const KEY = "prova.language";

/** Every string the field screens draw. `en` is the source: `es` is
 * checked against it key for key by strings-census.test.ts, so a new
 * sentence cannot ship in one language only. */
export type StringKey = keyof typeof EN;

const DICTIONARIES: Record<Language, Record<StringKey, string>> = { en: EN, es: ES };

/** What the phone itself is set to.
 *
 * Read from `Intl` rather than through a native module: the app already
 * relies on `toLocaleDateString`, and adding expo-localization for one
 * string would mean a new EAS build before any of this could reach a
 * phone. If the runtime cannot answer, English — a wrong guess at
 * somebody's language is worse than the language they already read the
 * rest of the app in.
 */
export function deviceLanguage(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    return locale.toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

let choice: LanguageChoice = "auto";
let language: Language = deviceLanguage();
const listeners = new Set<() => void>();

/** What `useT` snapshots.
 *
 * NOT the language, which is the obvious choice and is wrong: picking
 * "English" on a phone already in English changes `choice` and leaves
 * `language` alone, so a snapshot of the language re-renders nothing and
 * the selected pill in Settings stays on "Automatic". A counter moves on
 * every publish, so the screen always agrees with what was tapped. */
let version = 0;

function publish() {
  version += 1;
  for (const listener of listeners) listener();
}

export function resolve(pick: LanguageChoice): Language {
  return pick === "auto" ? deviceLanguage() : pick;
}

/**
 * Called once, before the first render that matters (app/_layout.tsx).
 *
 * It CANNOT throw. The gate that awaits it holds the first frame, so a
 * storage failure here would be a permanently blank app — and the
 * fallback is already correct for almost everybody, because `language`
 * starts on the phone's own setting. Losing the saved choice means the
 * app opens in the device's language, which is the default this module
 * is built around rather than a broken state.
 */
export async function loadLanguage(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  choice = saved === "en" || saved === "es" || saved === "auto" ? saved : "auto";
  language = resolve(choice);
  publish();
}

/**
 * The language changes on screen FIRST and is written after.
 *
 * Deliberate, and the reason is the phone this is for: a taper tapping
 * "Español" on a jobsite with no signal is not waiting on AsyncStorage
 * to acknowledge anything, and a write that fails must not leave the
 * app in a language nobody asked for. The worst case is the choice not
 * surviving a relaunch — which is the same place a first-time user
 * starts, and recoverable with one tap.
 */
export async function setLanguage(pick: LanguageChoice): Promise<void> {
  choice = pick;
  language = resolve(pick);
  publish();
  try {
    await AsyncStorage.setItem(KEY, pick);
  } catch {
    // See above: on screen now beats remembered later.
  }
}

export function currentLanguage(): Language {
  return language;
}

export function currentChoice(): LanguageChoice {
  return choice;
}

/**
 * One string, in the language in force.
 *
 * `{name}`-style placeholders are filled from `vars`, and a key with no
 * entry returns the ENGLISH one rather than the key itself: a screen
 * showing `time.hours` to somebody is worse than a screen showing
 * "Hours". The census is what stops that being load-bearing.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[language][key] ?? EN[key] ?? String(key);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** `t`, in a component, re-rendering when the language changes. */
export function useT(): { t: typeof t; language: Language; choice: LanguageChoice } {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => version,
    () => version,
  );
  return { t, language, choice };
}

/** For tests and for the language switch on a handed-over phone: set the
 * language without touching what the phone remembers. */
export function __setLanguageForRender(next: Language): void {
  language = next;
  publish();
}
