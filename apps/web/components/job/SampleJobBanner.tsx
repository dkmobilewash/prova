"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { deleteSampleJob } from "@/lib/actions";

/**
 * Over every tab of a sample job (`lib/sample-job`): what it is, in words, and how
 * to remove it. A status is a word and a colour, never a colour alone.
 */
export function SampleJobBanner({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-700 bg-tag-amber px-4 py-3" data-job="sample-banner">
      <div className="min-w-0 text-sm text-tag-amber-ink">
        <p>
          <span className="mr-2 rounded bg-tag-amber-ink px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-surface" data-job="sample-label">
            Sample
          </span>
          An invented drawing, already taken off, to show you the flow. It never uses your plan sheets.
        </p>
        <p className="mt-1">Follow the steps below: confirm what is left in Review, price the lines, then see the proposal. Upload your own plans on a new job when you are ready.</p>
        {error !== null && (
          <p role="alert" className="mt-1 font-medium">
            {error}
          </p>
        )}
      </div>
      <ConfirmDeleteButton
        label="Delete"
        describe="Removes this sample job, its takeoff and its estimate. Your real jobs are not touched."
        action={async () => {
          setError(null);
          try {
            const result = await deleteSampleJob(jobId);
            if (!result.ok) return setError(result.error);
            router.push("/jobs");
          } catch {
            setError("Couldn't delete the sample just now. Reload and try again.");
          }
        }}
      />
    </div>
  );
}
