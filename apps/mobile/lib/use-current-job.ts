import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { getCurrentJob, type CurrentJob } from "./current-job";

/**
 * The job this phone is on, re-read whenever the screen comes back into
 * view — switching jobs happens on a different tab, so a cached value held
 * in state would leave Home and Camera pointing at the old one.
 *
 * `loading` exists so a screen can tell "no job chosen yet" from "haven't
 * looked yet": the first renders a prompt to pick one, the second should
 * render nothing at all rather than flashing that prompt for a frame.
 */
export function useCurrentJob(): { job: CurrentJob | null; loading: boolean } {
  const [job, setJob] = useState<CurrentJob | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const current = await getCurrentJob();
        if (!alive) return;
        setJob(current);
        setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  return { job, loading };
}
