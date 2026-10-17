"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearSubcontractFindingDecision, decideSubcontractFinding } from "@/lib/actions";
import {
  citationLabel,
  DECISION_WORD,
  SEVERITY_WORD,
  type ReviewedFinding,
  type SubcontractDecisionKind,
} from "@/lib/subcontract-review/findings";
import { Spinner } from "@/components/Spinner";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * One finding, as a person decides about it.
 *
 * WHAT THE DOCUMENT SAID STAYS ON SCREEN BESIDE WHAT WE DECIDED IT MEANS. An
 * edited explanation or position is shown as the person's, with the original a
 * click away; the quote is never editable, because it is the evidence.
 *
 * Severity is a WORD and a colour, never a colour alone (CLAUDE.md, UI rules).
 */

export const SEVERITY_CLASS: Record<ReviewedFinding["severity"], string> = {
  HIGH: "bg-tag-rose text-tag-rose-ink",
  MEDIUM: "bg-tag-amber text-tag-amber-ink",
  LOW: "bg-tag-slate text-tag-slate-ink",
};

const STATUS_CLASS: Record<ReviewedFinding["status"], string> = {
  OPEN: "text-ink-muted",
  ACCEPTED: "text-ok",
  NEGOTIATED: "text-warn",
  DISMISSED: "text-ink-muted",
};

const buttonClass =
  "min-h-12 rounded-md border border-line-card px-3 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-60";

export function SubcontractFindingCard({
  jobId,
  finding,
  change,
}: {
  jobId: string;
  finding: ReviewedFinding;
  /** Set when a previous version was reviewed — what this version changed. */
  change?: "NEW" | "CHANGED" | "UNCHANGED" | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: SubcontractDecisionKind, extra?: FormData) => {
    setError(null);
    const formData = extra ?? new FormData();
    formData.set("key", finding.key);
    formData.set("decision", decision);
    if (!extra) {
      // A one-click decision keeps whatever the person already wrote.
      if (finding.note) formData.set("note", finding.note);
      if (finding.edited) {
        if (finding.effectiveSeverity !== finding.severity) formData.set("editedSeverity", finding.effectiveSeverity);
        if (finding.effectiveExplanation !== finding.explanation) formData.set("editedExplanation", finding.effectiveExplanation);
        if (finding.effectivePosition !== finding.suggestedPosition) formData.set("editedPosition", finding.effectivePosition);
      }
    }
    startTransition(async () => {
      const result = await decideSubcontractFinding(jobId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const clear = () => {
    setError(null);
    startTransition(async () => {
      const result = await clearSubcontractFindingDecision(jobId, finding.key);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const dismissed = finding.status === "DISMISSED";

  return (
    <article
      data-subcontract-finding={finding.key}
      data-status={finding.status}
      className={`flex flex-col gap-2 border-b border-line-row p-4 last:border-b-0 ${dismissed ? "opacity-70" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_CLASS[finding.effectiveSeverity]}`}>
          {SEVERITY_WORD[finding.effectiveSeverity]}
        </span>
        <h3 className="font-semibold text-ink">{finding.title}</h3>
        {change && change !== "UNCHANGED" && (
          <span className="rounded-full bg-tag-brand-soft px-2 py-0.5 text-xs font-medium text-tag-brand-soft-ink">
            {change === "NEW" ? "New in this version" : "Changed in this version"}
          </span>
        )}
        <span className={`ml-auto text-xs font-medium ${STATUS_CLASS[finding.status]}`} data-subcontract-review="status">
          {DECISION_WORD[finding.status]}
        </span>
      </header>

      <blockquote className="border-l-2 border-line-card pl-3 text-sm italic text-ink-body">“{finding.quote}”</blockquote>
      <p className="text-xs text-ink-muted">
        {finding.sourceLabel} · {citationLabel(finding)}
      </p>

      <p className="text-sm text-ink-body">
        <span className="font-medium text-ink-label">What it means: </span>
        {finding.effectiveExplanation}
      </p>
      <p className="text-sm text-ink-body">
        <span className="font-medium text-ink-label">Commonly negotiated: </span>
        {finding.effectivePosition}
      </p>
      {finding.questionForGc && (
        <p className="text-sm text-ink-body">
          <span className="font-medium text-ink-label">Ask the GC: </span>
          {finding.questionForGc}
        </p>
      )}
      {finding.note && (
        <p className="text-sm text-ink">
          <span className="font-medium text-ink-label">Your note: </span>
          {finding.note}
        </p>
      )}
      {finding.edited && (
        <div className="text-xs text-ink-muted">
          <button type="button" onClick={() => setShowOriginal((v) => !v)} className="text-link hover:underline">
            {showOriginal ? "Hide what the review originally said" : "You edited this — show what the review originally said"}
          </button>
          {showOriginal && (
            <div className="mt-1 flex flex-col gap-1">
              <p>{SEVERITY_WORD[finding.severity]}</p>
              <p>{finding.explanation}</p>
              <p>{finding.suggestedPosition}</p>
            </div>
          )}
        </div>
      )}

      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const decision = String(formData.get("chosenDecision") ?? "NEGOTIATED") as SubcontractDecisionKind;
            decide(decision, formData);
          }}
          className="flex flex-col gap-2 rounded-md border border-line-card bg-canvas p-3 print:hidden"
        >
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Severity
            <select
              name="editedSeverity"
              defaultValue={finding.effectiveSeverity}
              className="min-h-12 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink"
            >
              <option value="HIGH">{SEVERITY_WORD.HIGH}</option>
              <option value="MEDIUM">{SEVERITY_WORD.MEDIUM}</option>
              <option value="LOW">{SEVERITY_WORD.LOW}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            What it means for us
            <textarea
              name="editedExplanation"
              defaultValue={finding.effectiveExplanation}
              rows={3}
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Our position
            <textarea
              name="editedPosition"
              defaultValue={finding.effectivePosition}
              rows={2}
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Note
            <textarea
              name="note"
              defaultValue={finding.note ?? ""}
              rows={2}
              placeholder="e.g. Raised with the PM on the 14th"
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Mark it as
            <select
              name="chosenDecision"
              defaultValue={finding.status === "OPEN" ? "NEGOTIATED" : finding.status}
              className="min-h-12 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink"
            >
              <option value="NEGOTIATED">{DECISION_WORD.NEGOTIATED}</option>
              <option value="ACCEPTED">{DECISION_WORD.ACCEPTED}</option>
              <option value="DISMISSED">{DECISION_WORD.DISMISSED}</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={isPending} className={buttonClass}>
              {isPending ? <Spinner /> : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <RowActions
          className="flex flex-wrap items-center gap-2 print:hidden"
          destructive={
            finding.status !== "OPEN" ? (
              <ConfirmDelete
                label="Undo"
                confirmLabel="Clear it"
                describe="Clears your decision, note and edits on this finding, so it reads “Not reviewed yet” again. The finding itself stays."
                pending={isPending}
                onConfirm={clear}
              />
            ) : null
          }
        >
          {finding.status !== "ACCEPTED" && (
            <button type="button" disabled={isPending} onClick={() => decide("ACCEPTED")} className={buttonClass}>
              Accept as written
            </button>
          )}
          {finding.status !== "NEGOTIATED" && (
            <button type="button" disabled={isPending} onClick={() => decide("NEGOTIATED")} className={buttonClass}>
              Negotiate
            </button>
          )}
          <button type="button" disabled={isPending} onClick={() => setEditing(true)} className={buttonClass}>
            Edit or add a note
          </button>
          {finding.status !== "DISMISSED" && (
            <button type="button" disabled={isPending} onClick={() => decide("DISMISSED")} className={buttonClass}>
              Dismiss
            </button>
          )}
          {isPending && <Spinner />}
        </RowActions>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
