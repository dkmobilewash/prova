import { useEffect } from "react";
import { AppState } from "react-native";
import { tokenOrNull } from "./clerk-token";
import { flushQueue, pendingCount } from "./sync-queue";
import { reconcileReminder } from "./unsent-reminder";
import { useStableGetToken } from "./use-stable-get-token";

/**
 * Tries the queue again on its own, while the app is open.
 *
 * Until this, the queue drained only when a screen was focused or the app
 * came back from the background — so a phone sitting on the time screen
 * as the crew walked out of a basement held everything until somebody
 * navigated. The audit's words: "Time captured offline sits until the
 * foreman happens to log something else on that same screen."
 *
 * A TIMER rather than a connectivity listener, deliberately. NetInfo and
 * expo-network are native modules: adding one means a new EAS build
 * before any of this reaches a phone, and it would buy a few seconds of
 * latency over a 20-second tick. If that latency ever matters, the native
 * listener is a drop-in for the interval below and nothing else changes.
 *
 * Mounted once, in the tabs layout, so it is one timer for the app rather
 * than one per screen — and it keeps the end-of-day reminder in step with
 * what is actually still waiting.
 */
const EVERY_MS = 20_000;

export function useQueueDrain(): void {
  const getToken = useStableGetToken();

  useEffect(() => {
    let alive = true;

    const attempt = async () => {
      if (!alive) return;
      const pending = await pendingCount();
      // The reminder is reconciled even when there is nothing to send:
      // that is what cancels it once the last write has gone up.
      await reconcileReminder(pending);
      if (pending === 0) return;
      if (AppState.currentState !== "active") return;
      const token = await tokenOrNull(getToken);
      if (!token) return;
      try {
        await flushQueue(token);
      } catch {
        // 401 or offline. The queue keeps everything; the next tick tries
        // again, and nothing here is allowed to surface as an error on a
        // screen the person did not ask anything of.
      }
      if (alive) await reconcileReminder(await pendingCount());
    };

    void attempt();
    const timer = setInterval(() => void attempt(), EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [getToken]);
}
