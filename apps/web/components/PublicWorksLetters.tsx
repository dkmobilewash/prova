"use client";

import { useState, useTransition } from "react";
import { Button } from "@prova/ui";
import { Spinner } from "@/components/Spinner";
import { previewLetter, queueTier1Letters, sendQueuedLettersNow } from "@/lib/actions/letters";

/**
 * The Letters strip on /sales/public-works: what is queued, sent and
 * failed, and the two buttons that move letters between those states.
 * Both are disabled while either runs — "Send" pressed during "Queue"
 * would mail half a queue and leave the person unsure which half.
 */
export function PublicWorksLettersStrip({ counts, keyMode, configProblem }: { counts: { queued: number; sent: number; failed: number }; keyMode: "live" | "test" | "missing"; configProblem: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (action: () => Promise<{ ok: true; summary: string } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? { ok: true, text: result.summary } : { ok: false, text: result.error });
    });
  return (
    <section className="mb-6 rounded-xl border border-line-card bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-body">
        <span className="font-semibold text-ink">Letters</span>
        <span><strong className="text-ink">{counts.queued}</strong> queued</span>
        <span><strong className="text-ink">{counts.sent}</strong> sent</span>
        <span><strong className={counts.failed ? "text-danger" : "text-ink"}>{counts.failed}</strong> failed</span>
        <span className="text-xs text-ink-muted">
          {keyMode === "live" ? "Lob live key — Send mails real letters." : keyMode === "test" ? "Lob TEST key — Send renders, mails nothing." : "LOB_API_KEY unset — Send is refused."}
        </span>
      </div>
      {configProblem && <p className="mb-2 text-xs text-danger">{configProblem}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={pending || !!configProblem} onClick={() => run(queueTier1Letters)}>
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Working…
            </span>
          ) : (
            "Queue letters for tier 1"
          )}
        </Button>
        <Button type="button" variant="secondary" disabled={pending || counts.queued === 0 || keyMode === "missing"} onClick={() => run(sendQueuedLettersNow)}>
          Send queued (Lob)
        </Button>
        {message && <p className={`text-xs ${message.ok ? "text-ink-muted" : "text-danger"}`}>{message.text}</p>}
      </div>
    </section>
  );
}

/** One row's "Preview letter": renders the letter for THIS firm today and
 * shows it under the row. Fetched on open, not on render — 2,000 rows times
 * a letter each is not a page. */
export function PreviewLetterDisclosure({ licence, letterStatus }: { licence: string; letterStatus: string | null }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-xs text-link hover:text-link-hover hover:underline"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (body === null) startTransition(async () => {
            const result = await previewLetter(licence);
            setBody(result.ok ? result.body : `Cannot render: ${result.error}`);
          });
        }}
      >
        {open ? "Hide letter" : "Preview letter"}
        {letterStatus && <span className="ml-1 text-ink-muted">· letter {letterStatus.toLowerCase()}</span>}
      </button>
      {open && <pre className="mt-2 max-w-prose whitespace-pre-wrap rounded-lg border border-line-row bg-canvas p-3 font-sans text-xs text-ink-body">{pending && body === null ? "Rendering…" : body}</pre>}
    </div>
  );
}
