"use client";

import { useState, useTransition } from "react";

import { applyTemplateToEstimate } from "@/lib/actions";
import {
  templateApplication,
  templatesForTrade,
  type ExistingLine,
  type TemplateItemInput,
} from "@/lib/estimate-templates";

/**
 * Adding a saved template's lines to this estimate.
 *
 * THE WARNING IS SHOWN BEFORE THE PRESS, NOT AFTER. Applying a template
 * APPENDS — it does not sync and it does not skip — so applying one twice
 * adds every line twice, which is a real way to send a bid out double. The
 * same `templateApplication` the server re-runs is run here as you pick, so
 * the collision is on screen while there is still a decision to make.
 *
 * It does not refuse: a second floor's worth of the same lines is legitimate,
 * and a rule guessing which case this is would be wrong half the time.
 */

export type ApplicableTemplate = {
  id: string;
  name: string;
  tradeScope: string | null;
  items: TemplateItemInput[];
};

export function ApplyEstimateTemplate({
  jobId,
  jobTradeScope,
  templates,
  existingLines,
}: {
  jobId: string;
  jobTradeScope: string | null;
  templates: ApplicableTemplate[];
  existingLines: ExistingLine[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Templates for this job's trade, plus the untagged ones. When that leaves
  // nothing, every template is offered rather than an empty box: a filter
  // that silently hides the only thing somebody wanted is worse than a list
  // with an extra row in it.
  const forTrade = templatesForTrade(templates, jobTradeScope);
  const offered = forTrade.length > 0 ? forTrade : templates;

  const template = offered.find((candidate) => candidate.id === picked) ?? null;
  const plan = template ? templateApplication(template.items, existingLines) : null;

  if (templates.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Start from a template
      </button>
    );
  }

  return (
    <div className="rounded-md border border-line-row bg-surface-card p-3">
      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Template
        <select
          value={picked}
          onChange={(event) => {
            setPicked(event.target.value);
            setError(null);
          }}
          className="w-64 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        >
          <option value="">pick one…</option>
          {offered.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.items.length} line{candidate.items.length === 1 ? "" : "s"})
            </option>
          ))}
        </select>
      </label>

      {/* WHAT WILL BE ADDED, before anything is. */}
      {plan && (
        <div className="mt-2">
          {plan.caution && <p className="text-xs text-tag-amber-ink">{plan.caution}</p>}
          {plan.lines.length === 0 ? (
            <p className="mt-1 text-xs text-tag-amber-ink">
              This template has no lines on it yet, so it will not add anything.
            </p>
          ) : (
            <ul className="mt-1 list-inside list-disc text-xs text-ink-muted">
              {plan.lines.map((line, index) => (
                <li key={`${line.description}-${index}`}>
                  {line.description} — {line.quantity}
                  {line.unit ? ` ${line.unit}` : ""}
                  {line.catalogEntryId ? "" : " (unpriced)"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-tag-rose-ink">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending || !template || plan?.lines.length === 0}
          onClick={() => {
            if (!template) return;
            setError(null);
            const formData = new FormData();
            formData.set("templateId", template.id);
            startTransition(async () => {
              const result = await applyTemplateToEstimate(jobId, formData);
              if (result && !result.ok) setError(result.error);
              else {
                setOpen(false);
                setPicked("");
              }
            });
          }}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-60"
        >
          {isPending
            ? "Adding…"
            : plan
              ? `Add ${plan.lines.length} line${plan.lines.length === 1 ? "" : "s"}`
              : "Add lines"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked("");
            setError(null);
          }}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
