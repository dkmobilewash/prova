"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { refreshAccFeed } from "@/lib/actions";

/**
 * "Refresh from ACC", plus the same thing run once, quietly, when the page
 * opens with a stale cache (`stale`, decided on the server from each link's
 * last-refresh time). Same shape as ProcoreRefresh.tsx.
 *
 * The on-open refresh fires from an effect — after the page has rendered
 * from the cache — so opening /rfis never waits on Autodesk. The action
 * revalidates the page, which re-renders it with what was read.
 */
export function ACCRefresh({ jobId, stale }: { jobId: string | null; stale: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fired = useRef(false);

  function run(onlyStale: boolean) {
    startTransition(async () => {
      const result = await refreshAccFeed(jobId, onlyStale);
      if (!result.ok) {
        setFailed(true);
        setMessage(result.error);
        return;
      }
      setFailed(result.value.failed > 0);
      const { refreshed, failed: bad, skipped } = result.value;
      if (onlyStale && refreshed + bad === 0) {
        setMessage(null);
        return;
      }
      const parts = [`Read ${refreshed} project${refreshed === 1 ? "" : "s"} from ACC.`];
      if (bad > 0) parts.push(`${bad} had a problem — see the line under it.`);
      if (skipped > 0) parts.push(`${skipped} more will refresh next time.`);
      setMessage(parts.join(" "));
    });
  }

  useEffect(() => {
    if (stale && !fired.current) {
      fired.current = true;
      run(true);
    }
    // Once per mount, by design: `fired` is the guard, `run` is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => run(false)}
        disabled={pending}
        data-tour="acc-refresh"
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Reading ACC…" : "Refresh from ACC"}
      </button>
      {message && (
        <p role={failed ? "alert" : "status"} className={`max-w-xs text-right text-xs ${failed ? "text-red-400" : "text-ink-muted"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
