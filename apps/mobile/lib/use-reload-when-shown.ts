import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Loads the screen's data when it first shows, again every time the user
 * comes back to it, and again when the app returns from the background while
 * the screen is open.
 *
 * A screen that loaded only once, on mount, kept showing what it read then:
 * entries deleted on the web stayed on the phone's Time screen until you
 * left it and came back. The foreman opening the app in the morning should
 * see this morning's list.
 *
 * `load` is read through a ref, so a screen can pass its plain (re-created
 * every render) load function without the focus effect re-firing each time.
 */
export function useReloadWhenShown(load: () => Promise<void> | void) {
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  useFocusEffect(
    useCallback(() => {
      void latest.current();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void latest.current();
      });
      return () => subscription.remove();
    }, []),
  );
}
