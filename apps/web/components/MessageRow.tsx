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
} from "@/components/messageLabels";

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
  const [confirming, setConfirming] = useState(false);
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
  const reason = newestFirst(message.events).find((e) => e.detail)?.detail ?? null;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{channelLabel(message.channel)}</span>
        <span className="text-slate-100">{message.subject ?? "(no subject)"}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${chip}`}>{stateLabel(state)}</span>
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
        {message.jobName && <span className="text-blue-400">{message.jobName} · </span>}
        sent {message.sentAt}
        {message.relatedType && ` · about a ${message.relatedType.toLowerCase()}`}
        {message.sentByName && ` · by ${message.sentByName}`}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`${linkBtn} ml-2`}
          disabled={isPending}
        >
          {open ? "Hide" : "Show what was sent"}
        </button>
        {canDelete &&
          !message.wentOut &&
          (confirming ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deleteOutboundMessage(message.id))}
                className="ml-2 text-xs text-red-400 underline disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirming(false)}
                className={`${linkBtn} ml-2`}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(true)}
              className={`${linkBtn} ml-2`}
            >
              Remove
            </button>
          ))}
      </p>

      {open && (
        <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
          <p className="whitespace-pre-wrap text-sm text-slate-300">{message.body}</p>
          {message.events.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-l-2 border-slate-700 pl-3">
              {newestFirst(message.events).map((event) => (
                <li key={event.id} className="text-xs text-slate-400">
                  <span className="font-mono text-slate-500">{event.type}</span>
                  {` · ${event.occurredAt.replace("T", " ").slice(0, 16)}`}
                  {event.detail && <span className="text-slate-500"> — {event.detail}</span>}
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
