"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { addWallRun, deleteWallRun, refreshWallSchedule, updateWallRun } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { scheduleLines, type WallTypeInput } from "@/lib/wall-assemblies";
import { formatHours } from "@/lib/render-hours";

/**
 * A job's wall schedule, on its Estimate tab: each run of wall by type,
 * length and height. Every save regenerates the estimate's wall lines on the
 * server, in the same transaction, and the result says what moved.
 *
 * The add form previews with the SAME pure `scheduleLines` the server runs, so
 * the quantities shown before saving are the quantities saved — a preview that
 * disagrees with the row it creates is worse than none.
 */

type Summary = {
  created: number;
  updated: number;
  removed: number;
  unpricedRuns: { id: string; label: string }[];
  orphanRuns: { id: string; label: string }[];
};
type RunResult = { ok: true; value: Summary } | { ok: false; error: string };

export type WallRunView = {
  id: string;
  label: string;
  wallTypeId: string;
  lengthFt: string;
  heightFt: string | null;
  openings: { widthFt: number; heightFt: number }[];
};

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const small = "rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-ink hover:bg-neutral-700 disabled:opacity-50";
const labelClass = "flex flex-col gap-1 text-xs text-ink-label";

function describe(summary: Summary): string {
  const parts = [
    summary.created && `${summary.created} line${summary.created === 1 ? "" : "s"} added`,
    summary.updated && `${summary.updated} updated`,
    summary.removed && `${summary.removed} removed`,
  ].filter(Boolean);
  return parts.length ? `Estimate updated: ${parts.join(", ")}.` : "Estimate already matched the schedule.";
}

function useRunSubmit(run: (formData: FormData) => Promise<RunResult>, onDone: (message: string) => void, resetOnSuccess: boolean) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await run(formData);
      if (!result.ok) return setError(result.error);
      onDone(describe(result.value));
      if (resetOnSuccess) form.reset();
    });
  }
  return { isPending, error, onSubmit };
}

export function WallSchedule({
  jobId,
  types,
  runs,
  unpricedRunLabels,
}: {
  jobId: string;
  types: WallTypeInput[];
  runs: WallRunView[];
  unpricedRunLabels: string[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  if (types.length === 0) {
    return (
      <div className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
        Set up your wall types first — what a W1 or a W2 is made of — and each run you enter here turns into studs,
        track and board on this estimate.{" "}
        <Link href="/wall-types" className="text-link hover:underline">
          Open wall types
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-ink-body">
          Each run of wall by its type, length and height. The estimate&rsquo;s wall lines are worked out from these.
        </p>
        {runs.length > 0 && (
          <button
            type="button"
            disabled={isRefreshing}
            title="Re-applies the wall types as they are now. Editing a wall type never changes this estimate on its own."
            onClick={() =>
              startRefresh(async () => {
                const result = await refreshWallSchedule(jobId);
                setMessage(result.ok ? describe(result.value) : result.error);
              })
            }
            className="text-xs text-link hover:underline disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "Refresh from wall types"}
          </button>
        )}
      </div>

      {unpricedRunLabels.length > 0 && (
        <p className="text-sm text-tag-amber-ink">
          No height for {unpricedRunLabels.join(", ")} — give the run a height, or give its wall type a default. Until
          then it adds nothing to the estimate.
        </p>
      )}
      {message && <p className="text-sm text-ink-body">{message}</p>}

      {runs.length > 0 && (
        <ul className="divide-y divide-line-row rounded-md border border-line-row">
          {runs.map((run) => (
            <WallRunRow key={run.id} jobId={jobId} run={run} types={types} onDone={setMessage} typeCode={typeById.get(run.wallTypeId)?.code ?? "?"} />
          ))}
        </ul>
      )}

      <NewWallRunForm jobId={jobId} types={types} onDone={setMessage} />
    </div>
  );
}

function TypeSelect({ types, defaultValue, onChange }: { types: WallTypeInput[]; defaultValue?: string; onChange?: (id: string) => void }) {
  return (
    <select name="wallTypeId" defaultValue={defaultValue ?? types[0]?.id} onChange={(e) => onChange?.(e.target.value)} className={field}>
      {types.map((type) => (
        <option key={type.id} value={type.id}>
          {type.code}
        </option>
      ))}
    </select>
  );
}

function WallRunRow({
  jobId,
  run,
  types,
  typeCode,
  onDone,
}: {
  jobId: string;
  run: WallRunView;
  types: WallTypeInput[];
  typeCode: string;
  onDone: (message: string) => void;
}) {
  const save = useRunSubmit((fd) => updateWallRun(jobId, run.id, fd), onDone, false);
  const [isRemoving, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:justify-between">
      <form onSubmit={save.onSubmit} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
        <label className={`${labelClass} min-w-[140px] flex-1`}>
          Run
          <input name="label" defaultValue={run.label} className={field} />
        </label>
        <label className={labelClass}>
          Type
          <TypeSelect types={types} defaultValue={run.wallTypeId} />
        </label>
        <label className={labelClass}>
          Length (ft)
          <input name="lengthFt" defaultValue={run.lengthFt} inputMode="decimal" className={`${field} w-20`} />
        </label>
        <label className={labelClass}>
          Height (ft)
          <input name="heightFt" defaultValue={run.heightFt ?? ""} placeholder="type's" inputMode="decimal" className={`${field} w-20`} />
        </label>
        {/* Openings are kept as they were: the row edits the run, not its
            openings. One JSON field rather than hidden number boxes, because
            nobody types into it. */}
        <input type="hidden" name="keptOpenings" value={JSON.stringify(run.openings)} />
        {run.openings.length > 0 && (
          <span className="self-end pb-2 text-xs text-ink-muted">
            {run.openings.length} opening{run.openings.length === 1 ? "" : "s"}
          </span>
        )}
        <button type="submit" disabled={save.isPending} className={small} title={`Saves this ${typeCode} run and updates the estimate`}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {save.error && <p className="w-full text-sm text-tag-amber-ink">{save.error}</p>}
      </form>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <RowActions
          className="flex items-center justify-end gap-2"
          destructive={
            <ConfirmDelete
              pinned="end"
              describe="Takes this run off the wall schedule. The estimate's wall lines are worked out again without it."
              label="Remove"
              confirmLabel="Remove it"
              pendingLabel="Removing…"
              pending={isRemoving}
              onConfirm={() => {
                setRemoveError(null);
                startRemove(async () => {
                  const result = await deleteWallRun(jobId, run.id);
                  if (!result.ok) setRemoveError(result.error);
                  else onDone(describe(result.value));
                });
              }}
              deleteClassName="text-xs text-red-400 hover:underline"
            />
          }
        />
        {removeError && <p className="max-w-[16rem] text-right text-xs text-tag-amber-ink">{removeError}</p>}
      </div>
    </li>
  );
}

function NewWallRunForm({ jobId, types, onDone }: { jobId: string; types: WallTypeInput[]; onDone: (message: string) => void }) {
  const [wallTypeId, setWallTypeId] = useState(types[0]?.id ?? "");
  const [lengthFt, setLengthFt] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [openings, setOpenings] = useState<{ w: string; h: string }[]>([]);
  // Cleared only once the save is known to have worked: a refusal keeps every
  // figure that was typed, so fixing one field is not retyping five.
  const submit = useRunSubmit(
    (fd) => addWallRun(jobId, fd),
    (message) => {
      onDone(message);
      setLengthFt("");
      setHeightFt("");
      setOpenings([]);
    },
    true,
  );

  const preview = useMemo(() => {
    const n = (v: string) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    return scheduleLines(
      [
        {
          id: "preview",
          label: "preview",
          wallTypeId,
          lengthFt: n(lengthFt),
          heightFt: n(heightFt) || null,
          openings: openings.map((o) => ({ widthFt: n(o.w), heightFt: n(o.h) })).filter((o) => o.widthFt > 0 && o.heightFt > 0),
        },
      ],
      types,
    );
  }, [wallTypeId, lengthFt, heightFt, openings, types]);

  return (
    <form
      onSubmit={submit.onSubmit}
      className="flex flex-col gap-3 rounded-md border border-dashed border-line-card p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} min-w-[140px] flex-1`}>
          Run
          <input name="label" placeholder="Level 2 corridor" className={field} />
        </label>
        <label className={labelClass}>
          Type
          <TypeSelect types={types} defaultValue={wallTypeId} onChange={setWallTypeId} />
        </label>
        <label className={labelClass}>
          Length (ft)
          <input name="lengthFt" value={lengthFt} onChange={(e) => setLengthFt(e.target.value)} inputMode="decimal" className={`${field} w-20`} />
        </label>
        <label className={labelClass}>
          Height (ft)
          <input name="heightFt" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} placeholder="type's" inputMode="decimal" className={`${field} w-20`} />
        </label>
        {openings.map((opening, index) => (
          <span key={index} className="flex items-end gap-1">
            <input name="openingWidth" value={opening.w} onChange={(e) => setOpenings((p) => p.map((o, i) => (i === index ? { ...o, w: e.target.value } : o)))} placeholder="w ft" inputMode="decimal" aria-label="Opening width" className={`${field} w-16`} />
            <span className="pb-2 text-ink-muted">×</span>
            <input name="openingHeight" value={opening.h} onChange={(e) => setOpenings((p) => p.map((o, i) => (i === index ? { ...o, h: e.target.value } : o)))} placeholder="h ft" inputMode="decimal" aria-label="Opening height" className={`${field} w-16`} />
          </span>
        ))}
        <button type="button" onClick={() => setOpenings((p) => [...p, { w: "", h: "" }])} className="self-end pb-2 text-xs text-link hover:underline">
          + Opening
        </button>
      </div>

      <div className="rounded-md bg-canvas p-2 text-xs">
        {preview.lines.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {preview.lines.map((line) => (
              <li key={line.componentId} className="flex justify-between gap-3">
                <span className="text-ink-label">{line.description}</span>
                <span className="tabular-nums text-ink">
                  {line.quantity} {line.unit ?? ""}
                  {line.laborHours != null ? ` · ${formatHours(line.laborHours)} hrs` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : preview.unpricedRuns.length > 0 && Number(lengthFt) > 0 ? (
          <p className="text-tag-amber-ink">This wall type has no default height — enter the run&rsquo;s height.</p>
        ) : (
          <p className="text-ink-muted">Enter a length and the quantities appear here.</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submit.isPending || preview.lines.length === 0}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submit.isPending ? "Adding…" : "Add run"}
        </button>
        {submit.error && <p className="text-sm text-tag-amber-ink">{submit.error}</p>}
      </div>
    </form>
  );
}
