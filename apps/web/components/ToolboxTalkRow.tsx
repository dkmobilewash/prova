"use client";

import { useState, useTransition } from "react";
import { deleteToolboxTalk } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type ToolboxTalkRowData = {
  id: string;
  heldOn: string;
  topic: string;
  presenter: string | null;
  attendees: string | null;
  notes: string | null;
  jobName: string | null;
  recordedByName: string | null;
};

export function ToolboxTalkRow({ talk, canDelete }: { talk: ToolboxTalkRowData; canDelete: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-100">{talk.topic}</span>
          <span className="text-xs text-slate-400">{talk.heldOn}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {talk.jobName ? (
            <span className="text-blue-400">{talk.jobName}</span>
          ) : (
            <span>Not job-specific</span>
          )}
          {talk.presenter && ` · led by ${talk.presenter}`}
          {talk.recordedByName && ` · logged by ${talk.recordedByName}`}
        </p>
        {talk.attendees && <p className="mt-1 text-sm text-slate-300">Attended: {talk.attendees}</p>}
        {talk.notes && <p className="mt-1 text-sm text-slate-400">{talk.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* No ordinary actions at all in this cluster, which used to mean the
          two orders swapped outright at 640px — safe at 375 and 100% overlap
          at 1100 — so this row sat in PINNED_EXCEPTIONS with no `pinned` at
          all. #184's armed column decouples the two: below sm Cancel is on
          top whatever the order, so `pinned="end"` now buys the desktop
          (100% -> 0% at 1100px) for nothing. Numbers in
          `rowActionsCensus.test.ts`. */}
      {canDelete && (
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-3"
          destructive={
            <ConfirmDelete
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    await deleteToolboxTalk(talk.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not remove the talk");
                  }
                });
              }}
              deleteClassName="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              cancelClassName="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              confirmClassName="inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          }
        />
      )}
    </li>
  );
}
