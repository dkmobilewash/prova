"use client";

import { useState, useTransition } from "react";
import type { AgentKind } from "@prova/db";
import { runAgentNow } from "@/lib/actions/agents";
import { Spinner } from "@/components/Spinner";

/**
 * "Run now" for one agent. The action answers with a sentence either way —
 * ran, paused on the cap, switched off, or failed — and that sentence is
 * what the person reads, never a thrown message production would redact.
 */
export function RunAgentButton({
  agent,
  bidInvitationId,
  label = "Run now",
}: {
  agent: AgentKind;
  bidInvitationId?: string | null;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState<string | null>(null);

  function handleClick() {
    setText(null);
    startTransition(async () => {
      const result = await runAgentNow(agent, bidInvitationId ?? null);
      if (!result.ok) return setText(result.error);
      setText(result.outcome.ran ? result.outcome.summary : result.outcome.note);
    });
  }

  return (
    <div className="flex flex-col gap-1.5" data-agent={agent}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex w-fit items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:opacity-50"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Running…
          </span>
        ) : (
          label
        )}
      </button>
      {text ? (
        <p className="text-sm text-ink-body" role="status">
          {text}
        </p>
      ) : null}
    </div>
  );
}
