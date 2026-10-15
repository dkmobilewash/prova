"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@prova/ui";
import { approveReply, dismissReply, markReplyStop } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Spinner } from "@/components/Spinner";

/**
 * One reply waiting for a person: their words, the model's reading, the
 * draft to change or send. "Mark stop" is the row's destructive action —
 * it suppresses the lead everywhere and nothing un-suppresses — so it goes
 * through `RowActions`/`ConfirmDelete` like every other armed delete here,
 * which hides Approve and Dismiss while it is armed.
 */
export type ReplyForReview = {
  id: string;
  leadId: string;
  company: string;
  contact: string | null;
  fromEmail: string;
  subject: string | null;
  bodyText: string;
  receivedAt: string;
  classification: string;
  door: string;
  confidence: number;
  draft: string | null;
  draftRationale: string | null;
};

export function ReplyReviewRow({ reply }: { reply: ReplyForReview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(reply.draft ?? "");
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="rounded-lg border border-line-card bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/sales/${reply.leadId}`} className="font-medium text-ink hover:underline">
            {reply.company}
          </Link>
          <span className="ml-2 text-xs text-ink-muted">
            {reply.contact ? `${reply.contact} · ` : ""}
            {reply.fromEmail} · {reply.receivedAt}
          </span>
        </div>
        <span className="text-xs text-ink-label">
          {reply.classification.replace("_", " ")} · {reply.door.replace("_", " ")} ·{" "}
          {Math.round(reply.confidence * 100)}% sure
        </span>
      </div>

      {reply.subject ? <p className="mt-2 text-sm font-medium text-ink-body">{reply.subject}</p> : null}
      <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-line-card pl-3 text-sm text-ink-body">
        {reply.bodyText || "(no text)"}
      </blockquote>

      {reply.draftRationale ? <p className="mt-3 text-xs text-ink-muted">{reply.draftRationale}</p> : null}
      <label className="mt-2 block text-xs text-ink-label">
        Your answer
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
          disabled={pending}
          placeholder="No draft — write the answer, or dismiss."
          className="mt-1 w-full rounded-md border border-line-card bg-canvas p-2 text-sm text-ink"
        />
      </label>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <RowActions
        className="mt-3 flex flex-wrap items-center gap-2"
        destructive={
          <ConfirmDelete
            label="Mark stop"
            confirmLabel="Yes, stop"
            pendingLabel="Stopping…"
            describe="Marks this reply as a stop: the lead is suppressed everywhere, the sequence is told, and nothing un-suppresses it."
            prompt={`Stop emailing ${reply.company}?`}
            pending={pending}
            onConfirm={() => run(() => markReplyStop(reply.id))}
          />
        }
      >
        <Button type="button" disabled={pending || !draft.trim()} onClick={() => run(() => approveReply(reply.id, draft))}>
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Sending…
            </span>
          ) : (
            "Approve & send"
          )}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => dismissReply(reply.id))}>
          Dismiss
        </Button>
      </RowActions>
    </li>
  );
}
