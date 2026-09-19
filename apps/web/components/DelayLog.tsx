"use client";

import { useState, useTransition } from "react";
import { draftChangeOrderFromDelay, logDelay, removeDelay } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { localToday } from "@/components/localToday";
import { inputClass, labelClass } from "@/components/DailyFieldReports";

export type DelayView = {
  id: string;
  /** Formatted by the server: a calendar day, in UTC. */
  dateLabel: string;
  causeLabel: string;
  responsibleLabel: string;
  responsibleName: string | null;
  start: string | null;
  end: string | null;
  workersAffected: number | null;
  hoursLost: string | null;
  description: string;
  /** "Phone · Sam (super) · Sep 17, 2:10 PM", or null when the GC wasn't told. */
  notifiedLabel: string | null;
  /** "CO #4" when a change order was drafted from this delay. */
  changeOrderLabel: string | null;
  /** "Signed" / "Approved" when the day is locked. */
  lockedLabel: string | null;
};

export type Option = { value: string; label: string };

const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-xs text-red-400 hover:bg-tag-rose disabled:opacity-50";

/**
 * The job's delays, one row each: what happened, why, who caused it, how
 * long, how many people, and who at the GC was told. This replaces the old
 * free-text "Delays" box on the daily report, which could never carry a
 * claim.
 *
 * "Draft change order" turns a delay into a DRAFT change order prefilled
 * from its record; it is priced and sent the ordinary way. That works on a
 * signed day too — drafting one is what the office does afterwards.
 */
export function DelayLog({
  jobId,
  delays,
  causes,
  parties,
  methods,
  canDraftChangeOrder,
}: {
  jobId: string;
  delays: DelayView[];
  causes: Option[];
  parties: Option[];
  methods: Option[];
  /** False while the job is an estimate: there is no contract to change. */
  canDraftChangeOrder: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [notified, setNotified] = useState("");

  function run(fn: () => Promise<ActionResult>, onOk?: () => void, rowId: string | null = null) {
    setError(null);
    setErrorId(rowId);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) onOk?.();
        else setError(result.error);
      } catch {
        setError("That did not go through. Reload the page and check before trying again.");
      }
    });
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink">Delays</h3>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800"
          >
            Log a delay
          </button>
        )}
      </div>

      {isOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            // A datetime-local value carries no time zone. Turn it into an
            // instant HERE, in the browser that knows the person's zone,
            // rather than letting the server read it as UTC.
            const at = String(formData.get("gcNotifiedAtLocal") ?? "");
            if (at) formData.set("gcNotifiedAt", new Date(at).toISOString());
            const form = event.currentTarget;
            run(
              () => logDelay(jobId, formData),
              () => {
                form.reset();
                setNotified("");
                setIsOpen(false);
              },
            );
          }}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Date
              <input type="date" name="date" required defaultValue={localToday()} className={inputClass} />
            </label>
            <label className={labelClass}>
              Cause
              <select name="cause" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Pick a cause
                </option>
                {causes.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Caused by
              <select name="responsibleParty" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Pick who
                </option>
                {parties.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={labelClass}>
            Who, by name (optional)
            <input name="responsibleName" placeholder="e.g. Acme Electric, the GC's super" className={inputClass} />
          </label>
          <label className={labelClass}>
            What happened
            <textarea name="description" required rows={2} placeholder="What stopped the work, and what the crew did instead" className={inputClass} />
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={labelClass}>
              From
              <input name="startTime" placeholder="7:30" className={inputClass} />
            </label>
            <label className={labelClass}>
              To
              <input name="endTime" placeholder="10:00" className={inputClass} />
            </label>
            <label className={labelClass}>
              Workers affected
              <input name="workersAffected" inputMode="numeric" placeholder="4" className={inputClass} />
            </label>
            <label className={labelClass}>
              Crew-hours lost
              <input name="hoursLost" inputMode="decimal" placeholder="worked out if blank" className={inputClass} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              GC notified?
              <select name="gcNotifiedHow" value={notified} onChange={(e) => setNotified(e.target.value)} className={inputClass}>
                <option value="">Not yet</option>
                {methods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {notified && (
              <>
                <label className={labelClass}>
                  Told who
                  <input name="gcNotifiedWho" placeholder="e.g. Sam, the super" className={inputClass} />
                </label>
                <label className={labelClass}>
                  When (blank = now)
                  <input type="datetime-local" name="gcNotifiedAtLocal" className={inputClass} />
                </label>
              </>
            )}
          </div>
          {error && errorId === null && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save delay"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {delays.length === 0 ? (
        <p className="text-sm text-ink-body">
          No delays logged. Log each one with its cause, who caused it, the crew-hours it cost and who at the GC
          you told — that record is what a change order or a delay claim is built from.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {delays.map((d) => (
            <li key={d.id} className="rounded-md border border-line-card bg-surface p-3 text-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {d.dateLabel} · {d.causeLabel}
                  </p>
                  <p className="text-ink-body">
                    Caused by {d.responsibleLabel}
                    {d.responsibleName ? ` — ${d.responsibleName}` : ""}
                  </p>
                  <p className="mt-1 text-ink-label">{d.description}</p>
                  {(d.start || d.end || d.workersAffected !== null || d.hoursLost !== null) && (
                    <p className="mt-1 text-ink-body">
                      {[
                        d.start || d.end ? `${d.start ?? "?"} – ${d.end ?? "?"}` : null,
                        d.workersAffected !== null ? `${d.workersAffected} workers` : null,
                        d.hoursLost !== null ? `${d.hoursLost} crew-hours lost` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <p className={d.notifiedLabel ? "mt-1 text-ink-body" : "mt-1 text-amber-400"}>
                    {d.notifiedLabel ? `GC notified: ${d.notifiedLabel}` : "GC not recorded as notified"}
                  </p>
                  {d.changeOrderLabel && <p className="mt-1 text-ink-body">Change order drafted: {d.changeOrderLabel}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {d.lockedLabel && (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300">
                      {d.lockedLabel} · locked
                    </span>
                  )}
                  <RowActions
                    className="flex shrink-0 flex-wrap items-center gap-2"
                    destructive={
                      !d.lockedLabel && !d.changeOrderLabel ? (
                        <ConfirmDelete
                          describe="Removes this delay from the record. Only for one logged by mistake."
                          pinned="end"
                          label="Remove"
                          confirmLabel="Confirm remove"
                          pending={isPending}
                          onConfirm={() => run(() => removeDelay(d.id), undefined, d.id)}
                          deleteClassName={rowBtnDanger}
                          cancelClassName={rowBtn}
                          confirmClassName={rowBtnConfirm}
                        />
                      ) : null
                    }
                  >
                    {canDraftChangeOrder && !d.changeOrderLabel && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => draftChangeOrderFromDelay(d.id), undefined, d.id)}
                        className={rowBtn}
                      >
                        Draft change order
                      </button>
                    )}
                  </RowActions>
                </div>
              </div>
              {error && errorId === d.id && <p className="mt-1 text-sm text-red-400">{error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
