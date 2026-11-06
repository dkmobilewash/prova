"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Reads the page again when its tab comes back into view. The job stepper is
 * a server component, and its Scale and Takeoff steps change in the workspace,
 * which runs in a tab of its own: a job tab left open kept "Confirm the scales"
 * after every floor plan was scaled there (Chrome's re-test).
 */
export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);
  return null;
}
