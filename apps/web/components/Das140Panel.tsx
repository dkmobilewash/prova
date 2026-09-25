"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createDas140Notice,
  deleteDas140Notice,
  recordDas140Sent,
  updateDas140Notice,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { DAS140_ELECTIONS, das140ElectionLabel } from "@/lib/das-print";
import {
  DAS140_STATUS_LABEL,
  DAS140_STATUS_TONE,
  DAS_METHOD_LABEL,
  type Das140Standing,
} from "@/lib/das-forms";
import { formatCalendarDay } from "@/lib/render-date";
import { formatHours } from "@/lib/render-hours";
import { money } from "@/lib/money";
import type { Das140Row } from "@/lib/das-query";

/**
 * DAS 140 on a job — the award notice, one per craft per committee.
 *
 * ON THE JOB AND NOT BEHIND A NEW NAV DESTINATION. A DAS 140 is about one
 * contract award, and for a specialty-trade sub the award IS the job, so this
 * belongs on the job's Compliance tab beside the public-works facts the notice
 * is filled in from. The rail already carries 39 items; this adds none.
 *
 * THE STANDING IS COMPUTED ON THE SERVER AND HANDED IN. Derived state is never
 * stored (CLAUDE.md), and it is never derived HERE either: "today" has to be
 * the reader's own calendar day, which only the server can resolve
 * (`lib/viewerToday.ts`). A client component doing its own `new Date()` is the
 * #101 bug in a second costume.
 */

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";

type Result = { ok: true } | { ok: false; error: string };
export type Das140WithStanding = Das140Row & { standing: Das140Standing };
export type CommitteeOption = { id: string; label: string };

/** Every field the create and edit forms share. One component, because
 * `updateDas140Notice` writes the whole row and a field missing from one copy
 * would be silently cleared on save. */
function Das140Fields({
  values,
  committees,
  /** On an edit the committee is fixed: it is identity on the notice, and the
   * craft printed on the form is a snapshot taken from it at creation. */
  committeeEditable,
}: {
  values: {
    committeeId: string | null;
    election: string | null;
    contractExecutedOn: string | null;
    estimatedJourneymanHours: number | null;
    estimatedApprenticeHours: number | null;
    estimatedStartOn: string | null;
    estimatedCompletionOn: string | null;
    contractAmount: number | null;
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
              : "The craft on the notice is taken from the committee and then frozen."}
          </span>
        </label>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs text-ink-body">Which box applies</legend>
        {DAS140_ELECTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-xs text-ink-body">
            <input
              type="radio"
              name="election"
              value={option.value}
              defaultChecked={values.election === option.value}
              className="mt-0.5"
            />
            <span>
              <span className="text-ink-label">Box {option.box}</span> — {option.label}
            </span>
          </label>
        ))}
        <span className="text-xs text-ink-muted">
          Nothing is pre-ticked. The box is a declaration you are making to the state, and C Stream
          does not make declarations on your behalf. Which box is right is a question for your
          counsel — the wording here was read off secondary guidance, not off DIR.
        </span>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Contract executed on
          {/* Never defaulted to today: this is the date on the subcontract,
              and it is what the ten-day clock runs from. */}
          <input
            type="date"
            name="contractExecutedOn"
            defaultValue={values.contractExecutedOn ?? ""}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Expected start
          <input
            type="date"
            name="estimatedStartOn"
            defaultValue={values.estimatedStartOn ?? ""}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Expected completion
          <input
            type="date"
            name="estimatedCompletionOn"
            defaultValue={values.estimatedCompletionOn ?? ""}
            className={field}
          />
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

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Estimated journeyman hours
          <input
            name="estimatedJourneymanHours"
            type="text"
            inputMode="decimal"
            defaultValue={
              values.estimatedJourneymanHours === null
                ? ""
                : String(values.estimatedJourneymanHours)
            }
            className={`w-32 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Estimated apprentice hours
          <input
            name="estimatedApprenticeHours"
            type="text"
            inputMode="decimal"
            defaultValue={
              values.estimatedApprenticeHours === null ? "" : String(values.estimatedApprenticeHours)
            }
            className={`w-32 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Contract amount
          <input
            name="contractAmount"
            type="text"
            inputMode="decimal"
            defaultValue={values.contractAmount === null ? "" : String(values.contractAmount)}
            className={`w-32 ${field}`}
          />
        </label>
        <span className="max-w-sm pb-1 text-xs text-ink-muted">
          Your own estimate for this craft. C Stream will not work it out from the estimate&rsquo;s
          labor lines — those are priced work split by cost code, not by apprentice tier, and a
          projection made in your name on a state form is not ours to make.
        </span>
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

function StandingLine({ standing }: { standing: Das140Standing }) {
  const bound =
    standing.bound === "FIRST_WORKER"
      ? "the first day anyone logged hours on this job"
      : "ten days after the contract was executed";
  return (
    <p className="text-xs">
      <span className={DAS140_STATUS_TONE[standing.status]}>
        {DAS140_STATUS_LABEL[standing.status]}
      </span>
      <span className="text-ink-muted">
        {" · due "}
        {formatCalendarDay(standing.dueOn)} ({bound})
        {standing.daysRemaining !== null &&
          standing.daysRemaining >= 0 &&
          ` · ${standing.daysRemaining} ${standing.daysRemaining === 1 ? "day" : "days"} left`}
        {standing.daysRemaining !== null &&
          standing.daysRemaining < 0 &&
          ` · ${Math.abs(standing.daysRemaining)} ${Math.abs(standing.daysRemaining) === 1 ? "day" : "days"} past it`}
        {standing.daysLate !== null &&
          ` · ${standing.daysLate} ${standing.daysLate === 1 ? "day" : "days"} late`}
      </span>
    </p>
  );
}

function NoticeCard({
  jobId,
  notice,
  committees,
  canDelete,
}: {
  jobId: string;
  notice: Das140WithStanding;
  committees: readonly CommitteeOption[];
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "send">("view");
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

  const sent = notice.sentOn !== null;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">
            {notice.craftName} — {notice.committeeName}
          </span>
          <span className="text-xs text-ink-body">{das140ElectionLabel(notice.election)}</span>
          <StandingLine standing={notice.standing} />
          {sent && (
            <span className="text-xs text-ink-muted">
              Sent {formatCalendarDay(notice.sentOn!)}
              {notice.sentMethod !== null &&
                ` by ${DAS_METHOD_LABEL[notice.sentMethod] ?? notice.sentMethod}`}
              {notice.proofNote !== null && ` · proof: ${notice.proofNote}`}
            </span>
          )}
          {(notice.estimatedJourneymanHours !== null || notice.estimatedApprenticeHours !== null) && (
            <span className="text-xs text-ink-muted">
              Estimated{" "}
              {notice.estimatedJourneymanHours === null
                ? "— "
                : `${formatHours(notice.estimatedJourneymanHours)} jrny `}
              /{" "}
              {notice.estimatedApprenticeHours === null
                ? "—"
                : `${formatHours(notice.estimatedApprenticeHours)} appr`}
              {notice.contractAmount !== null && ` · ${money(notice.contractAmount)}`}
            </span>
          )}
          {notice.note !== null && <span className="text-xs text-ink-muted">— {notice.note}</span>}
        </div>

        <RowActions
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
          destructive={
            canDelete && !sent ? (
              <ConfirmDelete
                pinned="end"
                describe="Removes this unsent DAS 140 draft. Once a notice has been recorded as sent it cannot be removed by anyone — it is correspondence a committee received."
                label="Remove"
                confirmLabel="Confirm remove"
                pendingLabel="Removing…"
                pending={isPending}
                onConfirm={() => run(() => deleteDas140Notice(notice.id))}
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
          <Link href={`/jobs/${jobId}/das-140/${notice.id}`} className={btn}>
            Print the form
          </Link>
          {!sent && (
            <button type="button" disabled={isPending} onClick={() => setMode("send")} className={btn}>
              Record it sent
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
            run(() => recordDas140Sent(notice.id, formData), () => setMode("view"));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-2 border-t border-line-row pt-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-body">
              Sent on
              {/* Not defaulted to today. The postmark or the fax
                  confirmation is the date the ten-day test is judged on, and
                  it is routinely not the day somebody types it in. */}
              <input type="date" name="sentOn" className={field} />
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
                placeholder="e.g. fax confirmation in the job folder"
                className={`w-64 ${field}`}
              />
            </label>
          </div>
          <p className="text-xs text-tag-amber-ink/80">
            Recorded once. This date is what the ten-day test turns on, so it cannot be edited
            afterwards — check it before you save.
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

      {mode === "edit" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updateDas140Notice(notice.id, formData), () => setMode("view"));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-3 border-t border-line-row pt-3"
        >
          {sent ? (
            <>
              <p className="text-xs text-ink-muted">
                This notice has been sent, so only the notes can change. Everything else was on the
                paper that went to the committee.
              </p>
              <input
                name="note"
                defaultValue={notice.note ?? ""}
                placeholder="Note (optional)"
                className={field}
              />
              <input
                name="proofNote"
                defaultValue={notice.proofNote ?? ""}
                placeholder="Where the proof of transmission is"
                className={field}
              />
            </>
          ) : (
            <Das140Fields
              values={notice}
              committees={committees}
              committeeEditable={false}
            />
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
              {isPending ? "Saving…" : "Save notice"}
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

export function Das140Panel({
  jobId,
  notices,
  committees,
  canDelete,
}: {
  jobId: string;
  notices: readonly Das140WithStanding[];
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
      {notices.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">No DAS 140 recorded on this job.</p>
          <p className="mt-2 text-xs text-ink-muted">
            A DAS 140 tells an apprenticeship committee that you have been awarded this contract, for
            one craft. It is not a request for an apprentice — that is a DAS 142, below. Record one
            here per craft you will employ, and C Stream will show you the deadline and print the
            form.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {notices.map((notice) => (
            <NoticeCard
              key={notice.id}
              jobId={jobId}
              notice={notice}
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
              const result = await createDas140Notice(jobId, formData);
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
          <Das140Fields
            values={{
              committeeId: null,
              election: null,
              contractExecutedOn: null,
              estimatedJourneymanHours: null,
              estimatedApprenticeHours: null,
              estimatedStartOn: null,
              estimatedCompletionOn: null,
              contractAmount: null,
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
              {isPending ? "Saving…" : "Start the notice"}
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
          Start a DAS 140
        </button>
      )}
    </div>
  );
}
