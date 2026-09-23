"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDeterminationFacts } from "@/lib/actions";
import { formatCalendarDay } from "@/lib/render-date";
import { DeterminationFactsFields, type DeterminationFactsDefaults } from "@/components/DeterminationFactsFields";

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const label = "flex flex-col gap-1 text-xs text-ink-body";

const MARKER_TEXT = { NONE: "no asterisk", SINGLE: "*", DOUBLE: "**" } as const;

/** The facts as one short line under the determination, or the sentence
 * that says none were entered. Kept small: the standing line beside it is
 * the thing a reader is here for. */
function factsSummary(facts: DeterminationFactsDefaults): string | null {
  const parts: string[] = [];
  if (facts.determinationRef) parts.push(`No. ${facts.determinationRef}`);
  if (facts.issuedOn) parts.push(`issued ${formatCalendarDay(facts.issuedOn)}`);
  if (facts.expiresOn) {
    const marker = facts.expirationMarker ? ` (${MARKER_TEXT[facts.expirationMarker]})` : "";
    parts.push(`expires ${formatCalendarDay(facts.expiresOn)}${marker}`);
  } else if (facts.expirationMarker) {
    parts.push(`marked ${MARKER_TEXT[facts.expirationMarker]}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Inline edit of what a determination document says about itself —
 * number, issue date, expiration date, asterisk — on the row that shows
 * it. Every determination attached before these fields existed has none
 * of them, and this is how those rows get their dates without being
 * re-attached.
 *
 * `onSubmit` + `preventDefault()`, never the `action` prop: React 19
 * resets a form before its `action` runs, so a refusal would arrive over
 * fields snapped back to their stored values. A failed save leaves every
 * field exactly as typed, next to the reason (components/formActionCensus).
 */
export function DeterminationFactsEditor({
  jobId,
  determinationId,
  facts,
}: {
  jobId: string;
  determinationId: string;
  facts: DeterminationFactsDefaults;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const summary = factsSummary(facts);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-ink-muted">{summary ?? "Issue and expiration dates not entered."}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-link hover:underline"
          title="Enter the number, issue date, expiration date and asterisk printed on the determination. The standing line above is derived from them."
        >
          {summary ? "Edit dates" : "Enter dates"}
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
          const result = await updateDeterminationFacts(jobId, determinationId, formData);
          if (result.ok) {
            setOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      onInput={() => setError(null)}
      className="flex flex-col gap-2 rounded-md border border-line-card bg-canvas/40 p-2"
    >
      <DeterminationFactsFields defaults={facts} fieldClassName={field} labelClassName={label} />
      <p className="text-xs text-ink-muted">
        Read these off the document. Leave anything it doesn&rsquo;t say blank — a blank is reported as
        unchecked, never guessed.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save dates"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-3 py-1 text-xs text-ink-label hover:bg-neutral-800"
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
