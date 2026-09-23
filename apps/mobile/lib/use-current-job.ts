import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getCurrentJob, onCurrentJobChange, type CurrentJob } from "./current-job";

/**
 * The job this phone is on, re-read whenever the screen comes back into
 * view — switching jobs happens on a different tab, so a cached value held
 * in state would leave Home and Camera pointing at the old one.
 *
 * `loading` exists so a screen can tell "no job chosen yet" from "haven't
 * looked yet": the first renders a prompt to pick one, the second should
 * render nothing at all rather than flashing that prompt for a frame.
 *
 * FOCUS IS NOT THE ONLY TRIGGER, and the second one is load-bearing: the
 * capture sheet reads this from the tab layout, which keeps focus the
 * whole time you move between tabs, so on focus alone it never saw
 * "Leave <job>" happen and went on offering to file work against the job
 * you had left. `onCurrentJobChange` closes that; see current-job.ts.
 */
export function useCurrentJob(): { job: CurrentJob | null; loading: boolean } {
  const [job, setJob] = useState<CurrentJob | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onCurrentJobChange(() => {
        void getCurrentJob().then((current) => setJob(current));
      }),
    [],
  );

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
