"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createDas142Request,
  deleteDas142Request,
  recordDas142Response,
  recordDas142Sent,
  updateDas142Request,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  DAS142_OUTCOME_LABEL,
  DAS142_STATUS_LABEL,
  DAS142_STATUS_TONE,
  DAS_METHOD_LABEL,
  type Das142Standing,
} from "@/lib/das-forms";
import { formatCalendarDay } from "@/lib/render-date";
import type { Das142Row } from "@/lib/das-query";
import type { CommitteeOption } from "@/components/Das140Panel";

/**
 * DAS 142 on a job — the request to dispatch an apprentice.
 *
 * THE POINT OF THE WHOLE FEATURE IS ON THIS SCREEN. The apprentice ratio
 * already tells a contractor the day they went over; that day is in the past
 * and cannot be fixed by acting sooner. A DAS 142 is the thing that PREVENTS
 * the next one, and it has a lead time — so it is only useful before the fact,
 * which is why the deadline arithmetic runs backwards from the day somebody is
 * needed rather than forwards from anything.
 *
 * AND THE LEAD TIME IS DELIBERATELY REPORTED AS WEAKER THAN THE RULE. The
 * 72 hours exclude holidays and are counted to the hour; C Stream holds
 * neither a California holiday calendar nor a time of day. So the date shown
 * is a LATEST SEND DAY that ignores holidays, and the two caveats travel with
 * it as data from `lib/das-forms.ts` — the component cannot render the date
 * without them. A holiday only ever makes the real deadline earlier, so "this
 * is already late" is safe to say and "this looks in time" always carries what
 * could not be checked.
 */

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";

type Result = { ok: true } | { ok: false; error: string };
export type Das142WithStanding = Das142Row & { standing: Das142Standing };

function Das142Fields({
  values,
  committees,
  committeeEditable,
}: {
  values: {
    committeeId: string | null;
    apprenticesRequested: number | null;
    neededFrom: string | null;
    neededTo: string | null;
    projectIdentifier: string | null;
    note: string | null;
  };
  committees: readonly CommitteeOption[];
  committeeEditable: boolean;
}) {
  return (
    <>
      {committeeEditable && (
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Committee
          <select
            name="committeeId"
            defaultValue={values.committeeId ?? ""}
            className={`w-full max-w-md ${field}`}
            disabled={committees.length === 0}
          >
            <option value="">Choose a committee</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-ink-muted">
            {committees.length === 0
              ? "None recorded — add the committee for this craft and area under Union & apprentices first."
              : "One request per craft, per committee. Sending it to the wrong committee has its own penalty."}
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          How many apprentices
          <input
            name="apprenticesRequested"
            type="text"
            inputMode="numeric"
            defaultValue={
              values.apprenticesRequested === null ? "" : String(values.apprenticesRequested)
            }
            className={`w-24 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Needed from
          {/* The anchor the lead time counts back from. Not defaulted: a
              default would put a deadline on screen that nobody chose. */}
          <input
            type="date"
            name="neededFrom"
            defaultValue={values.neededFrom ?? ""}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Through (optional)
          <input type="date" name="neededTo" defaultValue={values.neededTo ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Project number
          <input
            name="projectIdentifier"
            defaultValue={values.projectIdentifier ?? ""}
            placeholder="off the call for bids"
            className={`w-44 ${field}`}
          />
        </label>
      </div>

      <input
        name="note"
        defaultValue={values.note ?? ""}
        placeholder="Note (optional)"
        className={field}
      />
    </>
  );
}

function StandingLine({ standing }: { standing: Das142Standing }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs">
        <span className={DAS142_STATUS_TONE[standing.status]}>
          {DAS142_STATUS_LABEL[standing.status]}
        </span>
        <span className="text-ink-muted">
          {" · send by "}
          {formatCalendarDay(standing.latestSendDay)}
          {standing.daysRemaining !== null &&
            standing.daysRemaining >= 0 &&
            ` · ${standing.daysRemaining} ${standing.daysRemaining === 1 ? "day" : "days"} left`}
          {standing.daysShort !== null &&
            ` · ${standing.daysShort} ${standing.daysShort === 1 ? "day" : "days"} short`}
          {" · "}
          {DAS142_OUTCOME_LABEL[standing.outcome]}
        </span>
      </p>
      {/* The caveats are DATA on the standing, so this cannot render the date
          without them. Two sentences, every time, because the date is an
          approximation of an hourly rule and a reader who takes it as exact
          has been misled by us rather than by the regulation. */}
      <ul className="flex flex-col gap-0.5">
        {standing.caveats.map((caveat) => (
          <li key={caveat} className="text-[11px] leading-snug text-tag-amber-ink/80">
            {caveat}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestCard({
  jobId,
  request,
  committees,
  canDelete,
}: {
  jobId: string;
  request: Das142WithStanding;
  committees: readonly CommitteeOption[];
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "send" | "reply">("view");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<Result>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const sent = request.requestedOn !== null;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">
            {request.apprenticesRequested}{" "}
            {request.apprenticesRequested === 1 ? "apprentice" : "apprentices"} ·{" "}
            {request.craftName} — {request.committeeName}
          </span>
          <span className="text-xs text-ink-body">
            Needed from {formatCalendarDay(request.neededFrom)}
            {request.neededTo !== null && ` through ${formatCalendarDay(request.neededTo)}`}
          </span>
          <StandingLine standing={request.standing} />
          {sent && (
            <span className="text-xs text-ink-muted">
              Sent {formatCalendarDay(request.requestedOn!)}
              {request.sentMethod !== null &&
                ` by ${DAS_METHOD_LABEL[request.sentMethod] ?? request.sentMethod}`}
              {request.proofNote !== null && ` · proof: ${request.proofNote}`}
            </span>
          )}
          {request.respondedOn !== null && (
            <span className="text-xs text-ink-muted">
              Replied {formatCalendarDay(request.respondedOn)}
              {request.outcomeNote !== null && ` · ${request.outcomeNote}`}
            </span>
          )}
          {request.note !== null && <span className="text-xs text-ink-muted">— {request.note}</span>}
        </div>

        <RowActions
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
          destructive={
            canDelete && !sent ? (
              <ConfirmDelete
                pinned="end"
                describe="Removes this unsent DAS 142 draft. Once a request has been recorded as sent it cannot be removed by anyone — a request a committee could not fill is the record that shows you asked."
                label="Remove"
                confirmLabel="Confirm remove"
                pendingLabel="Removing…"
                pending={isPending}
                onConfirm={() => run(() => deleteDas142Request(request.id))}
                hint={
                  <span className="max-w-[16rem] text-right text-ink-muted">
                    An unsent draft. Nothing has gone to the committee.
                  </span>
                }
                deleteClassName={btn}
                cancelClassName={btn}
                confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
              />
            ) : null
          }
        >
          <Link href={`/jobs/${jobId}/das-142/${request.id}`} className={btn}>
            Print the form
          </Link>
          {!sent && (
            <button type="button" disabled={isPending} onClick={() => setMode("send")} className={btn}>
              Record it sent
            </button>
          )}
          {sent && (
            <button type="button" disabled={isPending} onClick={() => setMode("reply")} className={btn}>
              Record the reply
            </button>
          )}
          <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
            Edit
          </button>
        </RowActions>
      </div>

      {mode === "send" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => recordDas142Sent(request.id, formData), () => setMode("view"));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-2 border-t border-line-row pt-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              Sent on
              <input type="date" name="requestedOn" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              How
              <select name="sentMethod" defaultValue="" className={`w-44 ${field}`}>
                <option value="">Choose one</option>
                <option value="FIRST_CLASS_MAIL">First class mail</option>
                <option value="FAX">Fax</option>
                <option value="EMAIL">Email</option>
                <option value="HAND_DELIVERED">By hand</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              Where the proof is
              <input
                name="proofNote"
                placeholder="e.g. emailed, confirmation saved"
                className={`w-64 ${field}`}
              />
            </label>
          </div>
          <p className="text-xs text-tag-amber-ink/80">
            Recorded once. The 72 hours are measured from this date, so it cannot be edited
            afterwards.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Record it sent"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "reply" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => recordDas142Response(request.id, formData), () => setMode("view"));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-2 border-t border-line-row pt-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              Replied on
              <input
                type="date"
                name="respondedOn"
                defaultValue={request.respondedOn ?? ""}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              What they said
              <select
                name="outcome"
                defaultValue={request.outcome ?? ""}
                className={`w-60 ${field}`}
              >
                <option value="">Nothing recorded</option>
                <option value="DISPATCHED">They dispatched somebody</option>
                <option value="UNABLE_TO_DISPATCH">They could not dispatch anybody</option>
                <option value="NO_RESPONSE">No reply came back</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              Note
              <input
                name="outcomeNote"
                defaultValue={request.outcomeNote ?? ""}
                placeholder="who, or what they said"
                className={`w-64 ${field}`}
              />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            &ldquo;Nothing recorded&rdquo; and &ldquo;no reply came back&rdquo; are different facts and
            C Stream keeps them apart: the second one means you checked, and it is the record that
            shows you asked and nobody came.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save the reply"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "edit" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updateDas142Request(request.id, formData), () => setMode("view"));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-3 border-t border-line-row pt-3"
        >
          {sent ? (
            <>
              <p className="text-xs text-ink-muted">
                This request has been sent, so only the notes can change. The day you needed somebody
                is frozen especially: moving it afterwards would turn a short-notice request into a
                timely one with nothing on screen to say so.
              </p>
              <input
                name="note"
                defaultValue={request.note ?? ""}
                placeholder="Note (optional)"
                className={field}
              />
              <input
                name="proofNote"
                defaultValue={request.proofNote ?? ""}
                placeholder="Where the proof of transmission is"
                className={field}
              />
            </>
          ) : (
            <Das142Fields values={request} committees={committees} committeeEditable={false} />
          )}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save request"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "view" && error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

export function Das142Panel({
  jobId,
  requests,
  committees,
  canDelete,
}: {
  jobId: string;
  requests: readonly Das142WithStanding[];
  committees: readonly CommitteeOption[];
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      {requests.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">No dispatch request recorded on this job.</p>
          <p className="mt-2 text-xs text-ink-muted">
            A DAS 142 is how you ask a committee to send an apprentice, and it has a lead time — so it
            only works before you need somebody, not after. Recording one here gives you the form, the
            day you have to send it by, and a record that you asked: a committee that cannot dispatch
            anybody is the thing that explains a crew with no apprentice on it.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              jobId={jobId}
              request={request}
              committees={committees}
              canDelete={canDelete}
            />
          ))}
        </ul>
      )}

      {open ? (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await createDas142Request(jobId, formData);
              if (result.ok) {
                formRef.current?.reset();
                setOpen(false);
                router.refresh();
              } else {
                setError(result.error);
              }
            });
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
        >
          <Das142Fields
            values={{
              committeeId: null,
              apprenticesRequested: null,
              neededFrom: null,
              neededTo: null,
              projectIdentifier: null,
              note: null,
            }}
            committees={committees}
            committeeEditable
          />
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Start the request"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className={btn}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`self-start ${btn}`}>
          Start a DAS 142
        </button>
      )}
    </div>
  );
}
