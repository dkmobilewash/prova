"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignEquipment,
  deleteEquipmentAssignment,
  returnEquipment,
  updateEquipmentAssignment,
} from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { inputClass, labelClass } from "@/components/RfiFields";
import {
  type AssignmentData,
  dayLabel,
  stayLength,
} from "@/components/equipmentDeployment";

export type JobChoice = { id: string; name: string };

/** Send a piece out, bring it back, and read where it has been.
 *
 * The two dates are ENTERED. A dispatcher recording on Friday that a lift
 * went out on Tuesday has to be able to say Tuesday, or every utilisation
 * figure computed over this table is wrong by however long the paperwork
 * sat — so `localToday()` is only a default, and it is safe to call during
 * render because nothing here renders until a button is clicked.
 */
export function EquipmentDeploymentControls({
  equipmentId,
  jobs,
  history,
  today,
  canDelete,
}: {
  equipmentId: string;
  jobs: JobChoice[];
  history: AssignmentData[];
  today: string;
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "send" | "return">("idle");
  const [showHistory, setShowHistory] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  /* On top of the actions' own revalidatePath("/equipment").
   *
   * Not belt-and-braces here. `open` is derived from the `history` PROP, and
   * it decides which button this row offers: a stale prop after a save shows
   * "Send out to a job" for a machine that is now out, or "Bring it back"
   * for one already in the yard. Every other list in this app goes stale in
   * a way you can see — a row missing, a row that should be gone. This one
   * goes stale in a way that invites the wrong click.
   *
   * The precedent is BackchargeForm: browser testing found two forms leaving
   * the page stale on revalidatePath alone while structurally identical ones
   * updated live, and nobody has explained why. Nothing about that
   * investigation says this component is on the safe side of the line.
   *
   * What a second click actually costs, since it is worth being exact: the
   * overlap check inside assignEquipment's transaction catches a repeat send
   * and refuses it, so no duplicate stay can be written — the damage is a
   * dispatcher told "that lift is already out on Maple" about a save that
   * had in fact just worked. Confusing, not corrupting. Cheap to prevent. */
  const open = history.find((h) => h.returnedOn === null) ?? null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {mode === "idle" && !open && jobs.length > 0 && (
          <button
            type="button"
            onClick={() => setMode("send")}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            Send out to a job
          </button>
        )}
        {mode === "idle" && open && (
          <button
            type="button"
            onClick={() => setMode("return")}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            Bring it back
          </button>
        )}
        {history.length > 0 && mode === "idle" && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
        )}
      </div>

      {mode === "send" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            formData.set("equipmentId", equipmentId);
            startTransition(async () => {
              const result = await assignEquipment(formData);
              if (result.ok) {
                router.refresh();
                setMode("idle");
              } else setError(result.error);
            });
          }}
          className="mt-2 flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-950 p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              To which job
              <select name="jobId" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose a job
                </option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Went out on
              <input
                type="date"
                name="sentOutOn"
                required
                defaultValue={localToday()}
                className={inputClass}
              />
              <span className="text-xs text-slate-500">
                The day it actually left, not the day you recorded it.
              </span>
            </label>
          </div>
          <label className={labelClass}>
            Note
            <input type="text" name="notes" placeholder="optional" className={inputClass} />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Send out"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "return" && open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await returnEquipment(open.id, formData);
              if (result.ok) {
                router.refresh();
                setMode("idle");
              } else setError(result.error);
            });
          }}
          className="mt-2 flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-950 p-3"
        >
          <label className={labelClass}>
            Came back on
            <input
              type="date"
              name="returnedOn"
              required
              defaultValue={localToday()}
              className={inputClass}
            />
            <span className="text-xs text-slate-500">
              It went out to {open.jobName} on {dayLabel(open.sentOutOn)}.
            </span>
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Bring it back"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setMode("idle");
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && mode === "idle" && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {showHistory && (
        <ul className="mt-2 flex flex-col gap-1 rounded-md border border-slate-800 bg-slate-950 p-3">
          {history.map((stay) =>
            editingId === stay.id ? (
              /* Correcting a stay. The dates ARE editable — unlike sent
                 correspondence this is a note about where a machine was, and
                 the common repair is a mistyped date. The overlap rule still
                 applies, ignoring this row so it can't collide with itself. */
              <li key={stay.id} className="rounded border border-slate-800 p-2">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setError(null);
                    const formData = new FormData(event.currentTarget);
                    startTransition(async () => {
                      const result = await updateEquipmentAssignment(stay.id, formData);
                      if (result.ok) {
                        router.refresh();
                        setEditingId(null);
                      } else setError(result.error);
                    });
                  }}
                  className="flex flex-col gap-2"
                >
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className={labelClass}>
                      Job
                      <select name="jobId" defaultValue={stay.jobId} className={inputClass}>
                        {jobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      Went out
                      <input
                        type="date"
                        name="sentOutOn"
                        required
                        defaultValue={stay.sentOutOn}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      Came back
                      <input
                        type="date"
                        name="returnedOn"
                        defaultValue={stay.returnedOn ?? ""}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <label className={labelClass}>
                    Note
                    <input
                      type="text"
                      name="notes"
                      defaultValue={stay.notes ?? ""}
                      className={inputClass}
                    />
                  </label>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {isPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setEditingId(null);
                        setError(null);
                      }}
                      className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            ) : (
            <li key={stay.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="text-slate-300">{stay.jobName}</span>{" "}
                <span className="text-slate-500">
                  {dayLabel(stay.sentOutOn)}
                  {stay.returnedOn ? ` → ${dayLabel(stay.returnedOn)}` : " → still out"} ·{" "}
                  {stayLength(stay, today)}
                </span>
                {stay.notes && <p className="text-xs text-slate-600">{stay.notes}</p>}
              </div>
              <span className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setEditingId(stay.id);
                  setConfirmingId(null);
                  setError(null);
                }}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500"
              >
                Edit
              </button>
              {canDelete &&
                (confirmingId === stay.id ? (
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const result = await deleteEquipmentAssignment(stay.id);
                          if (!result.ok) setError(result.error);
                          else router.refresh();
                          setConfirmingId(null);
                        });
                      }}
                      className="rounded border border-red-500 px-2 py-1 text-xs text-red-400"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setConfirmingId(null)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setConfirmingId(stay.id)}
                    className="shrink-0 rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-red-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                ))}
              </span>
            </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
