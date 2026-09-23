"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobComplianceFacts } from "@/lib/actions";
import { PUBLIC_WORKS_OPTIONS } from "@/lib/determination-facts";
import { formatCalendarDay } from "@/lib/render-date";

export type JobComplianceFacts = {
  siteCounty: string | null;
  publicWorks: boolean | null;
  /** YYYY-MM-DD or null. */
  bidAdvertisedOn: string | null;
  awardingBody: string | null;
};

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const label = "flex flex-col gap-1 text-xs text-ink-body";

function publicWorksText(value: boolean | null): string {
  if (value === true) return "yes";
  if (value === false) return "no — private work";
  return "not recorded";
}

/**
 * The four public-works facts on a job, entered where they are read: the
 * Compliance tab. The bid-advertisement date is the one that matters most
 * — it is what picks which prevailing-wage determination governs the whole
 * job (8 CCR 16000), and the standing line under each determination is
 * derived from it. ENTERED from the call for bids; there is no default and
 * nothing stamps it.
 *
 * Collapsed to one line behind an Edit button, so the tab reads as facts
 * first and a form second. `onSubmit` + `preventDefault()`, never the
 * `action` prop, so a refused save leaves every field as typed next to the
 * reason (components/formActionCensus).
 */
export function JobComplianceFactsForm({ jobId, facts }: { jobId: string; facts: JobComplianceFacts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nothingEntered =
    !facts.siteCounty && facts.publicWorks === null && !facts.bidAdvertisedOn && !facts.awardingBody;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-card bg-surface p-3 text-sm">
        {nothingEntered ? (
          <span className="text-ink-muted">
            Nothing entered yet. The bid-advertisement date is what picks which determination governs
            this job.
          </span>
        ) : (
          <span className="text-ink-body">
            County: <span className="text-ink">{facts.siteCounty ?? "—"}</span> · Public works:{" "}
            <span className="text-ink">{publicWorksText(facts.publicWorks)}</span> · Advertised for bid:{" "}
            <span className="text-ink">
              {facts.bidAdvertisedOn ? formatCalendarDay(facts.bidAdvertisedOn) : "—"}
            </span>{" "}
            · Awarding body: <span className="text-ink">{facts.awardingBody ?? "—"}</span>
          </span>
        )}
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-link hover:underline">
          {nothingEntered ? "Enter facts" : "Edit"}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await updateJobComplianceFacts(jobId, formData);
          if (result.ok) {
            setOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      onInput={() => setError(null)}
      className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>
          Site county
          <input name="siteCounty" defaultValue={facts.siteCounty ?? ""} placeholder="e.g. Los Angeles" className={`w-44 ${field}`} />
        </label>
        <label className={label}>
          Public works
          <select name="publicWorks" defaultValue={facts.publicWorks === null ? "" : facts.publicWorks ? "yes" : "no"} className={field}>
            {PUBLIC_WORKS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          First advertised for bid
          <input type="date" name="bidAdvertisedOn" defaultValue={facts.bidAdvertisedOn ?? ""} className={field} />
        </label>
        <label className={label}>
          Awarding body
          <input name="awardingBody" defaultValue={facts.awardingBody ?? ""} placeholder="As written on the call for bids" className={`w-56 ${field}`} />
        </label>
      </div>
      <p className="text-xs text-ink-muted">
        The advertisement date comes from the awarding body&rsquo;s call for bids, not from when you
        heard about the job. It decides which prevailing-wage determination governs the whole job.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save facts"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-tag-rose-ink">
          {error}
        </p>
      )}
    </form>
  );
}
