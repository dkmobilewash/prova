"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCloseoutSubmission,
  recordCloseoutResponse,
  reopenCloseoutSubmission,
  submitCloseoutPackage,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import { localToday } from "@/components/localToday";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { money } from "@/lib/money";
import type { CloseoutReadiness } from "@/lib/closeout-readiness";
import {
  blockerLabel,
  stageBadgeClass,
  stageLabel,
  submissionStatusLabel,
} from "@/components/closeoutPackageLabels";

export type CloseoutSubmissionData = {
  id: string;
  attempt: number;
  submittedOn: string;
  method: string | null;
  status: string;
  respondedOn: string | null;
  gcResponse: string | null;
  note: string | null;
  submittedByName: string | null;
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50";

/**
 * Whose move it is on a job's closeout, and the package's trip to the GC.
 *
 * The readiness line comes first on purpose. "3 required documents
 * outstanding, and $13,420 is sitting with the GC" is the sentence
 * somebody acts on; the submission history below it is the evidence for
 * the half of that sentence the GC would dispute.
 */
export function CloseoutPackagePanel({
  jobId,
  readiness,
  submissions,
  canDelete,
}: {
  jobId: string;
  readiness: CloseoutReadiness;
  submissions: CloseoutSubmissionData[];
  canDelete: boolean;
}) {
  const [openForm, setOpenForm] = useState<"none" | "submit">("none");
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("ACCEPTED");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        // On top of the action's own revalidatePath. Browser testing found
      // two union-compliance forms leaving the page stale until a manual
      // reload while others updated live; every action revalidates and
      // every form calls them the same way, so this is NOT a root-cause
      // fix. It is applied here because these components share that exact
      // pattern, and the same bug would sit unseen until someone hit it.
      // A save that looks like it did nothing gets clicked again, and no
      // create action here is idempotent.
        router.refresh();
        onOk?.();
      } else {
        setError(result.error);
      }
    });
  }

  function submit(
    event: React.FormEvent<HTMLFormElement>,
    action: (fd: FormData) => Promise<ActionResult>,
    onOk?: () => void,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => action(formData), onOk);
  }

  const latest = submissions[0] ?? null;
  const withGc = latest?.status === "SUBMITTED";

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Closeout package
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs ${stageBadgeClass(readiness.stage)}`}>
          {stageLabel(readiness.stage)}
        </span>
        {readiness.daysWithGc !== null && withGc && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
            {readiness.daysWithGc} day{readiness.daysWithGc === 1 ? "" : "s"} with them
          </span>
        )}
        {readiness.retainageAtStake > 0 && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-300">
            {money(readiness.retainageAtStake)} retainage held
          </span>
        )}
      </div>

      {readiness.blockers.length > 0 && (
        <p className="mt-2 text-sm text-slate-400">
          Holding it up: {readiness.blockers.map(blockerLabel).join(", ")}.
          {readiness.stage === "AWAITING_GC" && (
            <span className="text-amber-300">
              {" "}
              The package went anyway — worth knowing before they come back asking.
            </span>
          )}
        </p>
      )}

      {readiness.stage === "READY_TO_SUBMIT" && (
        <p className="mt-2 text-sm text-slate-400">
          Everything required is signed and nothing has gone to the GC.
          {readiness.retainageAtStake > 0 && (
            <> That is {money(readiness.retainageAtStake)} waiting on an email.</>
          )}
        </p>
      )}

      {submissions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {submissions.map((s) => (
            <li key={s.id} className="rounded-md border border-slate-700 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">Attempt {s.attempt}</span>
                <span className="text-sm text-slate-200">{submissionStatusLabel(s.status)}</span>
                <span className="text-xs text-slate-500">
                  sent {s.submittedOn}
                  {s.method && ` · ${s.method}`}
                  {s.respondedOn && ` · answered ${s.respondedOn}`}
                  {s.submittedByName && ` · by ${s.submittedByName}`}
                </span>
              </div>

              {s.note && <p className="mt-1 text-sm text-slate-400">{s.note}</p>}
              {s.gcResponse && (
                <p className="mt-1 border-l-2 border-slate-700 pl-3 text-sm text-slate-400">
                  <span className="text-slate-500">They said: </span>
                  {s.gcResponse}
                </p>
              )}

              {respondingTo === s.id ? (
                <form
                  onSubmit={(e) =>
                    submit(e, (fd) => recordCloseoutResponse(s.id, fd), () => setRespondingTo(null))
                  }
                  className="mt-3 flex flex-col gap-3"
                >
                  <label className={labelClass}>
                    What came back
                    <select
                      name="outcome"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                      className={inputClass}
                    >
                      <option value="ACCEPTED">They accepted the package</option>
                      <option value="REJECTED">They sent it back</option>
                    </select>
                  </label>
                  <label className={labelClass}>
                    Date they answered
                    <input
                      type="date"
                      name="respondedOn"
                      defaultValue={localToday()}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    {outcome === "REJECTED" ? "What they said was missing" : "Note"}
                    <textarea
                      name="gcResponse"
                      rows={2}
                      required={outcome === "REJECTED"}
                      placeholder={
                        outcome === "REJECTED"
                          ? "Whoever assembles the next one needs this — e.g. 'final unconditional waiver was the conditional form'"
                          : "Optional"
                      }
                      className={inputClass}
                    />
                  </label>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={isPending} className={primaryBtn}>
                      {isPending ? "Saving…" : "Record response"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setRespondingTo(null)}
                      className={btn}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                /* Arming the delete empties this row. "Record response" and
                   "Reopen" both used to stay live beside the armed confirm —
                   issue #152 — so one click past where you meant to stop
                   reopened a submission you were trying not to touch. They
                   are children of RowActions now, which covers whatever gets
                   added to this row next. */
                <RowActions
                  className="mt-2 flex flex-wrap gap-2"
                  destructive={
                    canDelete ? (
                      <ConfirmDelete
                        confirmLabel="Confirm delete"
                        pendingLabel="Deleting…"
                        pending={isPending}
                        onConfirm={() => run(() => deleteCloseoutSubmission(s.id))}
                        deleteClassName={btn}
                        cancelClassName={btn}
                        confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      />
                    ) : null
                  }
                >
                  {s.status === "SUBMITTED" && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setRespondingTo(s.id);
                        setOutcome("ACCEPTED");
                        setError(null);
                      }}
                      className={btn}
                    >
                      Record response
                    </button>
                  )}
                  {s.status !== "SUBMITTED" && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => reopenCloseoutSubmission(s.id))}
                      className={btn}
                    >
                      Reopen
                    </button>
                  )}
                </RowActions>
              )}
            </li>
          ))}
        </ul>
      )}

      {openForm === "submit" ? (
        <form
          onSubmit={(e) => submit(e, submitCloseoutPackage, () => setOpenForm("none"))}
          className="mt-3 flex flex-col gap-3 rounded-md border border-slate-700 p-3"
        >
          <input type="hidden" name="jobId" value={jobId} />
          <label className={labelClass}>
            Date it went out
            <input
              type="date"
              name="submittedOn"
              required
              defaultValue={localToday()}
              className={inputClass}
            />
            <span className="text-xs text-slate-500">
              The date it actually left, not today — a package entered a fortnight late must not read
              as a fortnight of GC silence.
            </span>
          </label>
          <label className={labelClass}>
            How it went
            <input
              type="text"
              name="method"
              placeholder="e.g. emailed to PM, or uploaded to their Procore"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Note
            <textarea
              name="note"
              rows={2}
              placeholder="Optional — e.g. 'sent short the consent of surety, promised Friday'"
              className={inputClass}
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Record submission"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setOpenForm("none")}
              className={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setOpenForm("submit");
              setError(null);
            }}
            className={btn}
          >
            {submissions.length === 0 ? "Record the package going out" : "Send another attempt"}
          </button>
          {error && respondingTo === null && openForm === "none" && (
            <span className="text-sm text-red-400">{error}</span>
          )}
        </div>
      )}
    </section>
  );
}
