"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { AskProposalCard, type ProposalOutcome } from "@/components/AskProposalCard";
import { cancelAskProposal, confirmAskProposal } from "@/lib/actions";
import type { AskRequest, ClarifyView, ProposalView } from "@/lib/ask/answer";
import { readAskStream } from "@/lib/ask/streamClient";
import { askHref } from "@/lib/bid/askHrefs";
import type { BidAskAccess } from "@/lib/bid/guide/askAccess";
import {
  EMPTY_ASK_BOX,
  applyAskEvent,
  hasResult,
  startQuestion,
  type AskBoxEvent,
  type AskBoxState,
} from "@/lib/bid/guide/askBoxState";

/**
 * "Ask or tell me anything about <job>" — the box at the bottom of a job's
 * screen in C Stream Bid. It asks Ask, about THIS job.
 *
 * THE SAME ASSISTANT, NOT A SECOND ONE. It posts to `/api/ask` exactly as
 * `AskPanel` does, reads the stream with the panel's own reader
 * (lib/ask/streamClient.ts) by the panel's own rules (lib/bid/guide/
 * askBoxState.ts), and draws a command's card with the panel's own
 * `AskProposalCard`. So every gate the panel meets — the server key, the
 * company's AI switch, the courtesy rate limits, the paid monthly cap, the
 * number-provenance guard — reaches this box as the same sentence.
 *
 * WHAT IT SENDS THAT THE PANEL DOES NOT:
 *   - `pagePath: /bid/estimates/<jobId>`, built from the job rather than read
 *     off the address bar. On the Bid host the browser's path is
 *     `/estimates/<id>` (middleware rewrites it), which the page-context parser
 *     deliberately does not read; the box knows its job, so it says it. Still
 *     a hint and never an authority: lib/ask/page-context.ts.
 *   - `surface: "bid"`, which NARROWS the commands offered to the few that
 *     write in place on this estimate (lib/ask/surface.ts). It cannot widen
 *     anything; a forged value is the CRM's list.
 *
 * NOTHING IS WRITTEN ON SEND. A question can end in a card; the card's
 * confirm is the write, through `confirmAskProposal` — the same Server Action
 * the panel's tap runs — and the page is refreshed after it so the estimate
 * shows the new line.
 *
 * NO DOOR OUT OF BID. Every href Ask builds is a CRM route, so the card is
 * drawn with `surface="bid"` and a citation is a link only when it is a /bid
 * path (`askHref`); otherwise its label is plain text. The server also drops
 * the answer's record buttons on Bid (`linksFor`), so none are drawn here.
 *
 * When the company has switched AI off, or the server has no key, the box is
 * not drawn as an input at all: the sentence is, so nobody types into a box
 * that will only refuse them. `access` is decided on the server
 * (lib/bid/guide/askAccess.ts).
 */
export function JobGuideAskBox({
  jobId,
  jobName,
  access,
}: {
  jobId: string;
  jobName: string;
  access: BidAskAccess;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskBoxState>(EMPTY_ASK_BOX);
  const [isAsking, setIsAsking] = useState(false);
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);
  const [isConfirming, startConfirm] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  // The thread id, readable when the next question is sent. State alone would
  // be stale inside a send that started before the last answer finished.
  const threadRef = useRef<string | null>(null);

  // Leaving the page stops the answer in flight rather than letting it run on
  // and bill for an answer nobody will see.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(request: AskRequest, shown: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // A card nobody confirmed is withdrawn on the server, as the panel does,
    // so it cannot be confirmed later from a stale tab.
    if (state.proposal && !outcome) void cancelAskProposal(state.proposal.proposalId);
    setOutcome(null);
    setTapError(null);
    setState((current) => startQuestion(current, shown));
    setIsAsking(true);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...request,
          pagePath: `/bid/estimates/${jobId}`,
          surface: "bid",
          subject: { type: "Job", id: jobId },
          ...(threadRef.current ? { threadId: threadRef.current } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        // The status says whether this server refused (4xx) or broke (5xx),
        // which the bare sentence could not — the model's own failures
        // arrive inside the stream with Anthropic's reason attached.
        const error = `The assistant is unavailable right now (this server answered ${response.status}). Try again shortly.`;
        setState((current) => applyAskEvent(current, { type: "error", error }));
        return;
      }
      await readAskStream<AskBoxEvent>(response.body, (event) => {
        if (event.type === "thread") threadRef.current = event.threadId;
        setState((current) => applyAskEvent(current, event));
      });
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setState((current) => applyAskEvent(current, { type: "error", error: "The assistant is unavailable right now. Try again shortly." }));
      }
    } finally {
      if (abortRef.current === controller) {
        setIsAsking(false);
        setState((current) => ({ ...current, status: null }));
      }
    }
  }

  function ask() {
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;
    setQuestion("");
    void send({ question: trimmed }, trimmed);
  }

  /** A chip: the same question, with the person's pick, and no model pass. */
  function choose(current: ClarifyView, value: string) {
    void send(
      {
        question: state.asked,
        continuation: { command: current.command, partialInput: current.partialInput, answers: { [current.field]: value } },
      },
      state.asked,
    );
  }

  function confirm(current: ProposalView) {
    setTapError(null);
    startConfirm(async () => {
      const result = await confirmAskProposal(current.proposalId, []);
      if (result.ok) {
        setOutcome(result.value);
        // The write landed on THIS job; redraw the estimate, the rail and the
        // bid total around the box so the screen agrees with the card.
        router.refresh();
      } else {
        setTapError(result.error);
      }
    });
  }

  function cancel(current: ProposalView) {
    startConfirm(async () => {
      await cancelAskProposal(current.proposalId);
      setState((s) => ({ ...s, proposal: null }));
      setTapError(null);
    });
  }

  function startOver() {
    abortRef.current?.abort();
    if (state.proposal && !outcome) void cancelAskProposal(state.proposal.proposalId);
    threadRef.current = null;
    setState(EMPTY_ASK_BOX);
    setOutcome(null);
    setTapError(null);
    setIsAsking(false);
  }

  const label = `Ask or tell me anything about ${jobName}`;
  const showing = hasResult(state) || isAsking;

  return (
    <div className="min-w-0 rounded-lg border border-line-card bg-surface p-3 print:hidden" data-guide="ask-box">
      {!access.available ? (
        <div className="flex items-start gap-2" data-guide="ask-off">
          <AiMark />
          <p role="status" className="min-w-0 break-words pt-1 text-sm text-ink-body">
            {access.reason}
          </p>
        </div>
      ) : (
        <>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <AiMark />
            <label htmlFor="guide-ask-box" className="sr-only">
              {label}
            </label>
            <input
              id="guide-ask-box"
              name="guideQuestion"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={label}
              maxLength={1000}
              autoComplete="off"
              enterKeyHint="send"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-line-card bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none sm:text-sm"
            />
            <button
              type="submit"
              disabled={isAsking || question.trim() === ""}
              aria-busy={isAsking || undefined}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAsking ? (
                <>
                  <Spinner />
                  <span>Asking…</span>
                </>
              ) : (
                "Send"
              )}
            </button>
          </form>
          {!showing && (
            <p className="mt-2 text-xs text-ink-muted" data-guide="ask-hint">
              {access.canChange
                ? "Ask what the bid comes to, or tell it to add a line. Nothing changes until you confirm it."
                : "Ask anything about this job. Adding to the estimate needs cost access, which your role doesn't have."}
            </p>
          )}
        </>
      )}

      {access.available && showing && (
        <div className="mt-3 min-w-0" data-guide="ask-result" aria-live="polite">
          <p className="break-words text-sm font-medium text-ink-label">{state.asked}</p>

          {isAsking && (state.status || state.progress) && (
            <p className="mt-2 flex items-start gap-2 whitespace-pre-line break-words text-sm text-ink-body" data-ask="progress">
              <Spinner className="mt-1" />
              <span className="min-w-0">{state.progress || state.status}</span>
            </p>
          )}

          {/* Prose, never markup: a path the model wrote is text, not a link. */}
          {state.answer && (
            <p className="mt-2 max-w-prose whitespace-pre-line break-words text-base leading-relaxed text-ink" data-ask="answer">
              {state.answer}
            </p>
          )}

          {state.error && (
            <p role="alert" className="mt-2 break-words text-sm text-tag-rose-ink">
              {state.error}
            </p>
          )}

          {state.clarify && (
            <div className="mt-2" data-ask="clarify">
              <p className="text-sm text-ink">{state.clarify.question}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {state.clarify.options.map((option) => (
                  <li key={option.value} className="min-w-0 max-w-full">
                    <button
                      type="button"
                      disabled={isAsking}
                      onClick={() => choose(state.clarify!, option.value)}
                      className="inline-flex min-h-11 max-w-full flex-col items-start rounded-md border border-line-card px-3 py-1.5 text-left hover:border-link disabled:opacity-50"
                    >
                      <span className="break-words text-sm text-ink">{option.label}</span>
                      {option.detail && <span className="break-words text-xs text-ink-body">{option.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.proposal && (
            <AskProposalCard
              surface="bid"
              proposal={state.proposal}
              pending={isConfirming}
              error={tapError}
              outcome={outcome}
              onConfirm={() => confirm(state.proposal!)}
              onCancel={() => cancel(state.proposal!)}
            />
          )}

          {state.citations.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-body" data-ask="citations">
              <span>Read from</span>
              {state.citations.map((citation) => {
                const citationHref = askHref("bid", citation.href);
                return citationHref ? (
                  <Link key={citation.href} href={citationHref} className="underline hover:text-link">
                    {citation.label}
                  </Link>
                ) : (
                  <span key={citation.href}>{citation.label}</span>
                );
              })}
            </p>
          )}

          {!isAsking && hasResult(state) && (
            <button
              type="button"
              onClick={startOver}
              className="mt-2 inline-flex min-h-11 items-center text-xs text-ink-body underline hover:text-link"
            >
              Ask something else
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The yellow "AI" mark the screen's headline also carries. Decoration. */
function AiMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-neutral-900"
    >
      AI
    </span>
  );
}
