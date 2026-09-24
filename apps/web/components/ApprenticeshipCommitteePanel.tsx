"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createApprenticeshipCommittee,
  deleteApprenticeshipCommittee,
  updateApprenticeshipCommittee,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  ApprenticeshipCommitteeFields,
  EMPTY_COMMITTEE,
  type CommitteeFieldValues,
} from "@/components/ApprenticeshipCommitteeFields";
import type { CommitteeRow } from "@/lib/das-query";

/**
 * The committee directory: add collapsed behind a button, inline row edit,
 * two-step delete, a real empty state with a way out.
 *
 * WHY THE DIRECTORY IS COMPANY-LEVEL AND LIVES HERE. The same committee
 * receives a DAS 140 for every award in its area, so a per-job copy would be
 * one address retyped per job and free to differ between them. It sits on
 * `/union-compliance`, beside the apprentice ratio and the program
 * registrations, rather than behind a new nav destination: the rail already
 * has 39 items and this is the same conversation as the two panels above it.
 */

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";

type Result = { ok: true } | { ok: false; error: string };

function approvalLine(approved: boolean | null): { text: string; tone: string } {
  if (approved === true) return { text: "approved us to train", tone: "text-tag-green-ink" };
  if (approved === false) return { text: "has not approved us to train", tone: "text-ink-body" };
  // The third value, said out loud. Whether a contractor is approved to train
  // decides how many DAS 140s an award owes, so a blank must not read as "no".
  return {
    text: "not recorded whether they approved us to train",
    tone: "text-tag-amber-ink",
  };
}

function CommitteeRowCard({
  committee,
  crafts,
  canDelete,
}: {
  committee: CommitteeRow;
  crafts: readonly { id: string; label: string }[];
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
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

  const delivery = [
    committee.addressLine1 ? "post" : null,
    committee.email ? "email" : null,
    committee.fax ? "fax" : null,
  ].filter(Boolean);
  const approval = approvalLine(committee.approvedToTrainUs);
  const values: CommitteeFieldValues = { ...committee };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">{committee.name}</span>
          <span className="text-xs text-ink-body">
            {committee.craftName} · {committee.geographicArea}
            {committee.programSponsorNumber !== null && ` · program ${committee.programSponsorNumber}`}
          </span>
          <span className="text-xs text-ink-muted">
            {delivery.length > 0 ? (
              `Receives notices by ${delivery.join(", ")}`
            ) : (
              <span className="text-tag-rose-ink">
                No address, email or fax — a notice to this committee cannot be sent yet
              </span>
            )}
            {" · "}
            <span className={approval.tone}>{approval.text}</span>
          </span>
          {committee.sourceUrl !== null && (
            <a
              href={committee.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-link hover:underline"
            >
              Where this came from
            </a>
          )}
          {committee.note !== null && (
            <span className="text-xs text-ink-muted">— {committee.note}</span>
          )}
        </div>

        <RowActions
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
          destructive={
            canDelete ? (
              <ConfirmDelete
                pinned="end"
                describe="Removes this committee from your directory. Notices and requests already recorded against it are not removed, and a committee that still has any cannot be removed at all."
                label="Remove"
                confirmLabel="Confirm remove"
                pendingLabel="Removing…"
                pending={isPending}
                onConfirm={() => run(() => deleteApprenticeshipCommittee(committee.id))}
                hint={
                  <span className="max-w-[18rem] text-right text-ink-muted">
                    {committee.noticeCount + committee.requestCount > 0
                      ? `${committee.noticeCount + committee.requestCount} notice(s) point at this committee, so this will be refused.`
                      : "Only the directory entry goes."}
                  </span>
                }
                deleteClassName={btn}
                cancelClassName={btn}
                confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
              />
            ) : null
          }
        >
          <button
            type="button"
            disabled={isPending}
            onClick={() => setEditing((open) => !open)}
            className={btn}
          >
            {editing ? "Stop editing" : "Edit"}
          </button>
        </RowActions>
      </div>

      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updateApprenticeshipCommittee(committee.id, formData), () => setEditing(false));
          }}
          onInput={() => setError(null)}
          className="flex flex-col gap-3 border-t border-line-row pt-3"
        >
          <ApprenticeshipCommitteeFields values={values} crafts={crafts} craftEditable={false} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save committee"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setEditing(false)} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

export function ApprenticeshipCommitteePanel({
  committees,
  crafts,
  canDelete,
}: {
  committees: readonly CommitteeRow[];
  crafts: readonly { id: string; label: string }[];
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      {committees.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">No apprenticeship committees recorded.</p>
          <p className="mt-2 text-xs text-ink-muted">
            A DAS 140 and a DAS 142 both go to a committee — for one craft, in one area. C Stream
            holds no directory of them and will not invent one: look yours up on DIR&rsquo;s own list
            and record it once here, and every notice on every job can then be addressed from it.
            Until there is one committee here, the DAS sections on a job have nowhere to send
            anything.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {committees.map((committee) => (
            <CommitteeRowCard
              key={committee.id}
              committee={committee}
              crafts={crafts}
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
              const result = await createApprenticeshipCommittee(formData);
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
          <ApprenticeshipCommitteeFields values={EMPTY_COMMITTEE} crafts={crafts} />
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
              {isPending ? "Saving…" : "Add committee"}
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
          Add a committee
        </button>
      )}
    </div>
  );
}
