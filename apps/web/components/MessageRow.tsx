"use client";

import { useState, useTransition } from "react";
import { deleteOutboundMessage } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import {
  type MessageData,
  channelLabel,
  messageState,
  needsAttention,
  newestFirst,
  recipient,
  stale,
  stateLabel,
  relatedLabel,
} from "@/components/messageLabels";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type MessageRowData = MessageData & {
  jobName: string | null;
  sentByName: string | null;
  body: string;
  relatedType: string | null;
  wentOut: boolean;
};

const linkBtn = "text-xs text-slate-500 underline disabled:opacity-50";

export function MessageRow({
  message,
  today,
  canDelete,
}: {
  message: MessageRowData;
  today: string;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
    });
  }

  const state = messageState(message.events);
  const isStale = stale(message, today);
  const attention = needsAttention(message.events);

  const chip =
    state === "DELIVERED"
      ? "bg-green-500/15 text-green-300"
      : attention
        ? "bg-red-500/15 text-red-300"
        : isStale
          ? "bg-amber-500/15 text-amber-300"
          : "bg-slate-800 text-slate-400";

  // The reason a bounce is actionable at all. Surfaced on the row rather
  // than hidden behind the expander, because a bounce nobody reads is the
  // same as no bounce.
  const reason =
    newestFirst(message.events).find((e) => e.detail)?.detail ?? null;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-500">
          {channelLabel(message.channel)}
        </span>
        <span className="text-slate-100">
          {message.subject ?? "(no subject)"}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${chip}`}>
          {stateLabel(state)}
        </span>
        {isStale && !attention && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">
            No confirmation since {message.sentAt}
          </span>
        )}
      </div>

      <p className="text-sm text-slate-300">
        To {recipient(message)}
        <span className="text-slate-500">
          {" · from "}
          {message.fromAddress}
        </span>
      </p>

      {reason && <p className="text-sm text-red-300">{reason}</p>}

      <p className="text-xs text-slate-500">
        {message.jobName && (
          <span className="text-blue-400">{message.jobName} · </span>
        )}
        sent {message.sentAt}
        {message.relatedType && ` · about ${relatedLabel(message.relatedType)}`}
        {message.sentByName && ` · by ${message.sentByName}`}
        {/* A span, not a div: this cluster sits inside the <p> above and a
            block child there is invalid HTML. Arming "Remove" hides the
            "Show what was sent" toggle with it — it is a child of
            RowActions — so nothing in this row stays clickable beside the
            armed confirm. */}
        <RowActions
          as="span"
          destructive={
            canDelete && !message.wentOut ? (
              <ConfirmDelete
                label="Remove"
                confirmLabel="Confirm remove"
                pendingLabel="Removing…"
                pending={isPending}
                onConfirm={() => run(() => deleteOutboundMessage(message.id))}
                deleteClassName={`${linkBtn} ml-2`}
                cancelClassName={`${linkBtn} ml-2`}
                confirmClassName="ml-2 text-xs text-red-400 underline disabled:opacity-50"
              />
            ) : null
          }
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`${linkBtn} ml-2`}
            disabled={isPending}
          >
            {open ? "Hide" : "Show what was sent"}
          </button>
        </RowActions>
      </p>

      {open && (
        <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
          <p className="whitespace-pre-wrap text-sm text-slate-300">
            {message.body}
          </p>
          {message.events.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-l-2 border-slate-700 pl-3">
              {newestFirst(message.events).map((event) => (
                <li key={event.id} className="text-xs text-slate-400">
                  <span className="font-mono text-slate-500">{event.type}</span>
                  {` · ${event.occurredAt.replace("T", " ").slice(0, 16)}`}
                  {event.detail && (
                    <span className="text-slate-500"> — {event.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {message.events.length === 0 && (
            <p className="mt-3 text-xs text-slate-500">
              The provider hasn&apos;t reported anything about this one yet.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </li>
  );
}
