"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  deletePunchListItem,
  markPunchListItemReady,
  reopenPunchListItem,
  updatePunchListItem,
  verifyPunchListItem,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import type { JobOption } from "@/components/PunchListForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import { jobPickerLabel } from "@/components/jobLabels";
import { PunchItemFields, type PunchItemFieldValues, type PunchListPeople } from "@/components/PunchItemFields";
import { assigneeLabel, isOverdue, punchStatusLabel, wantsFixPhoto } from "@/lib/punch-items";
import type { PunchItemStatus } from "@prova/db";

// `text-base` is load-bearing, not decoration: these inputs sit inside a
// `text-sm` label and INHERIT 14px, and iOS Safari zooms the page whenever
// a focused field is under 16px. On a phone that leaves the foreman zoomed
// in and scrolled sideways after every tap. `min-h-11` is 44px.
const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink focus:border-link focus:outline-none";

// One definition for the row's controls, so they can't drift back under 44px
// a button at a time. `inline-flex` + `items-center` is what makes min-h
// actually centre the label instead of pinning it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50";
const primaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50";

/** The state, said in a colour as well as a word.
 *
 * Deliberately NOT a tick box any more. A checkbox has two states and this
 * has three, and the middle one — the crew says it is fixed, nobody has
 * agreed yet — is the entire point of the feature. Rendering three states
 * in a control that can only show two is how the split quietly becomes
 * decoration. */
const STATUS_CHIP: Record<PunchItemStatus, string> = {
  OPEN: "border-line-card text-ink-label",
  READY_FOR_REVIEW: "border-brand text-link",
  VERIFIED: "border-green-600 text-green-400",
};

export type PunchListRowItem = PunchItemFieldValues & {
  id: string;
  description: string;
  jobId: string;
  jobName: string;
  status: PunchItemStatus;
  dueOn: Date | null;
  assignedUserName: string | null;
  assignedCrewMemberName: string | null;
  raisedByName: string | null;
  readyByName: string | null;
  verifiedByName: string | null;
  reopenReason: string | null;
  photoCount: number;
};

type PunchListRowProps = {
  canDelete: boolean;
  canVerify: boolean;
  jobs: JobOption[];
  people: PunchListPeople;
  item: PunchListRowItem;
  showJob: boolean;
  /** Passed in from the server render rather than read from the clock here:
   * a date computed in the browser makes "overdue" depend on the tester's
   * timezone, and this app stores and renders dates at UTC. */
  today: Date;
};

export function PunchListRow({ canDelete, canVerify, jobs, people, item, showJob, today }: PunchListRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSendingBack, setIsSendingBack] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the item id so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`punch-list:edit:${item.id}`);

  /** Runs an action and renders the sentence it refuses with.
   *
   * Was a try/catch over `err.message`, which in production is React's
   * "the specific message is omitted in production builds" paragraph rather
   * than anything this app wrote — so the per-call fallback strings it took
   * ("Could not save changes") were the only text ever shown, and the
   * reasons never arrived. These actions return their refusals now, so
   * there is a real sentence and nothing to fall back to. Same shape as
   * `SubmittalRow`. */
  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            // The draft is cleared and the form closed only on the OK
            // branch — a refused save leaves every field exactly as typed.
            run(
              () => updatePunchListItem(item.id, formData),
              () => {
                draft.clear();
                setIsEditing(false);
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <FormDraftNotice draft={draft} />
          <select name="jobId" defaultValue={item.jobId} className={inputClass}>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {jobPickerLabel(job)}
              </option>
            ))}
          </select>
          <input type="text" name="description" required defaultValue={item.description} className={inputClass} />

          <PunchItemFields people={people} values={item} showBlame />

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const assignee = assigneeLabel(item);
  const overdue = isOverdue({ dueOn: item.dueOn, status: item.status }, today);

  return (
    // Stacks on a phone, side by side from sm up — the same shape
    // SafetyIncidentRow and RfiRow already use. Measured at 375px, the old
    // single-row layout gave the description column 116px, and 0px once the
    // three confirm-delete buttons appeared: the item you were about to
    // delete was squeezed out of its own row entirely.
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${STATUS_CHIP[item.status]}`}>
            {punchStatusLabel(item.status)}
          </span>
          {item.causedByOthers && (
            <span className="inline-flex items-center rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-label">
              Damaged by others
            </span>
          )}
          {overdue && (
            <span className="inline-flex items-center rounded-md border border-red-500 px-2 py-0.5 text-xs text-red-400">
              Overdue
            </span>
          )}
        </div>

        <p className={`mt-1 ${item.status === "VERIFIED" ? "text-ink-muted line-through" : "text-ink"}`}>
          {item.description}
        </p>

        {/* ink-body, not ink-muted: the muted level is under the 4.5 text floor. */}
        <p className="text-xs text-ink-body">
          {showJob && <span className="text-link">{item.jobName}</span>}
          {showJob && item.area && " · "}
          {item.area}
          {assignee && ` · ${assignee}`}
          {item.dueOn && ` · due ${item.dueOn.toISOString().slice(0, 10)}`}
          {item.raisedByName && ` · raised by ${item.raisedByName}`}
          {item.status === "READY_FOR_REVIEW" && item.readyByName && ` · ready per ${item.readyByName}`}
          {item.status === "VERIFIED" && item.verifiedByName && ` · verified by ${item.verifiedByName}`}
        </p>

        {/* Why it came back is the sentence that settles the argument later,
            so it is on the row rather than buried in an edit form. */}
        {item.status === "OPEN" && item.reopenReason && (
          <p className="mt-1 text-xs text-ink-body">Sent back: {item.reopenReason}</p>
        )}

        {/* Asked for, never enforced — see wantsFixPhoto(). The link goes
            where the photos are; the phone is what attaches one to this
            item at the shutter. */}
        {wantsFixPhoto(item) && (
          <p className="mt-1 text-xs text-ink-body">
            No photo of the fix.{" "}
            <Link href={`/photos?job=${item.jobId}`} className="text-link">
              Add one
            </Link>{" "}
            — a closed item with no picture is a claim, not evidence.
          </p>
        )}

        {isSendingBack && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              run(
                () => reopenPunchListItem(item.id, formData),
                () => setIsSendingBack(false),
              );
            }}
            className="mt-3 flex flex-col gap-2"
          >
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Why is it going back?
              <input
                type="text"
                name="reopenReason"
                required
                autoFocus
                placeholder="e.g. grid still 10mm out at the north end"
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {/* Cancel takes the pixel the armed control vacated — see
                  CLAUDE.md. This pair is left-aligned inside the row body,
                  so Cancel is FIRST here, the opposite of a right-pinned
                  cluster. */}
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsSendingBack(false);
                  setError(null);
                }}
                className={rowBtn}
              >
                Cancel
              </button>
              <button type="submit" disabled={isPending} className={primaryBtn}>
                {isPending ? "Sending back…" : "Send it back"}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-1 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Arming "Remove" empties this cluster: "Edit" used to stay live
          beside the armed "Confirm remove", so one click past where you
          meant to stop opened the edit form instead of cancelling. It is a
          child of RowActions now, and so is whatever gets added here next.

          `pinned="end"` measured against #89's stacking: 1100px 100% -> 0%.
          The phone was 86% either way until #184's armed column, which is 0%
          at 639 and 375. Numbers in `rowActionsCensus.test.ts`. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-3"
        destructive={
          canDelete ? (
            <ConfirmDelete
              describe="Removes the punch item from this job's list, with its status and notes."
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => run(() => deletePunchListItem(item.id))}
              deleteClassName={rowBtnDanger}
              cancelClassName={rowBtn}
              confirmClassName={rowBtnConfirm}
            />
          ) : null
        }
      >
        {item.status === "OPEN" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markPunchListItemReady(item.id))}
            className={rowBtn}
          >
            Mark ready
          </button>
        )}
        {item.status === "READY_FOR_REVIEW" && canVerify && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => verifyPunchListItem(item.id))}
            className={rowBtn}
          >
            Verify
          </button>
        )}
        {/* Sending back a VERIFIED item undoes somebody's signature, so the
            action refuses it without VERIFY_PUNCH_ITEMS. The button is
            hidden rather than left to refuse: a control that always fails
            for this person is a support call. */}
        {item.status !== "OPEN" && (item.status === "READY_FOR_REVIEW" || canVerify) && !isSendingBack && (
          <button type="button" disabled={isPending} onClick={() => setIsSendingBack(true)} className={rowBtn}>
            Send back
          </button>
        )}
        <button type="button" disabled={isPending} onClick={() => setIsEditing(true)} className={rowBtn}>
          Edit
        </button>
      </RowActions>
    </li>
  );
}
