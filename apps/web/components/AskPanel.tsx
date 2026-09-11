"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { AskRequest, AskStreamEvent, ClarifyView, ProposalView } from "@/lib/ask/answer";
import type { Citation } from "@/lib/ask/tools";
import { cancelAskProposal, confirmAskProposal, loadAskProposal } from "@/lib/actions";
import { AskProposalCard, type ProposalOutcome } from "@/components/AskProposalCard";

/** The ask box on the dashboard.
 *
 * Deliberately not a chat. There is no thread and no history: a question
 * about this week's money is answered from today's rows, and a scrollback
 * of stale answers is a place for a number to be read long after it stopped
 * being true. Ask, read, ask again.
 *
 * It can now DO things as well as answer, and that did not make it a chat.
 * A command ends the stream with a card or a row of chips; the card is one
 * tap to confirm or cancel, the chips re-run the same question with the
 * pick, and either way the task dies on "Ask something else". Nothing
 * here remembers a previous question.
 */

/** Shown until someone types. Each one is a question this app can actually
 * answer — an example that returns "I don't have that" teaches people the
 * feature does not work.
 *
 * And none of them names a specific job. One did, and the job did not
 * exist in the data: a chip that asks about a job you do not have is the
 * same broken promise, dressed as a worked example. */
/** Where a pending card's id lives while a phone browser is backgrounded.
 * sessionStorage, not localStorage: it dies with the tab, and a card is
 * not a standing instruction. Every access is wrapped, since storage can
 * throw in a private window and the panel must still render. */
const PENDING_CARD_KEY = "askProposalId";

function rememberCard(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PENDING_CARD_KEY, id);
    else sessionStorage.removeItem(PENDING_CARD_KEY);
  } catch {
    // No storage, no reattach; nothing else changes.
  }
}

function rememberedCard(): string | null {
  try {
    return sessionStorage.getItem(PENDING_CARD_KEY);
  } catch {
    return null;
  }
}

const EXAMPLES = [
  "What's overdue and who do I chase first?",
  "Which drawings am I not building to the latest revision of?",
  "What's left on the punch list?",
  "Anything expiring I should renew?",
];

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Text streamed before any tool has run is the model talking to itself
  // ("I'll pull the areas that could change your day") and is discarded
  // when results arrive. It goes in the STATUS slot, never the answer
  // slot.
  //
  // The first attempt at this kept it in the answer element and only
  // restyled it. That was wrong twice over: the restyle was invisible to a
  // reader who had already seen a sentence appear where answers appear,
  // and it was invisible to measurement too, since `text-ink-body`
  // contains `text-ink` as a substring and the element is identified by
  // `whitespace-pre-line` either way. Now the answer element simply does
  // not exist until there is an answer, which nothing can misread.
  const [progress, setProgress] = useState("");
  // Refs, not state: `apply` needs to read these synchronously while
  // handling a stream event, and a state updater must stay pure — doing
  // the read by calling setState with a side effect inside would
  // double-append under React's double-invoked updaters.
  const provisionalRef = useRef(true);
  const progressRef = useRef("");
  const [isAsking, setIsAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A command's card, a resolver's chips, and what a confirmed card became.
  // Only one of the first two exists at a time; both die on the next ask.
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [clarify, setClarify] = useState<ClarifyView | null>(null);
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);
  const [isConfirming, startConfirm] = useTransition();

  // Asking something else, or leaving, must stop the request in flight —
  // otherwise a slow answer to an abandoned question arrives later and
  // overwrites the one being read.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A card proposed before the tab went to the background comes back with
  // it. The server decides whether it is still this person's, unsettled
  // and unexpired; anything else and the id is simply forgotten.
  useEffect(() => {
    const id = rememberedCard();
    if (!id) return;
    startConfirm(async () => {
      const result = await loadAskProposal(id);
      if (result.ok) {
        setAsked(result.value.question);
        setProposal(result.value.proposal);
      } else {
        rememberCard(null);
      }
    });
    // Mount only: a reattach is a one-time read of what the tab remembered.
  }, []);

  function apply(event: AskStreamEvent) {
    switch (event.type) {
      case "tools":
        // The sentence is built on the server, which knows the registry;
        // this component must not import it, since it imports the database.
        setStatus(event.label);
        break;
      case "answering":
        // Tools are done; what streams from here is the answer itself, and
        // whatever the model said before that is discarded.
        provisionalRef.current = false;
        progressRef.current = "";
        setProgress("");
        break;
      case "reset":
        setAnswer("");
        progressRef.current = "";
        setProgress("");
        break;
      case "text":
        if (provisionalRef.current) {
          progressRef.current += event.delta;
          setProgress(progressRef.current);
        } else {
          setAnswer((current) => current + event.delta);
        }
        break;
      case "done":
        setCitations(event.citations);
        setStatus(null);
        // An answer that called no tool at all — a refusal, a clarifying
        // question — never gets `answering`, so everything it said is
        // sitting in the progress slot. Move it across, or a refusal
        // renders as a status line that never resolves into an answer.
        if (provisionalRef.current && progressRef.current) {
          setAnswer(progressRef.current);
          progressRef.current = "";
          setProgress("");
        }
        provisionalRef.current = false;
        break;
      case "proposal":
        // Terminal. Whatever the model was saying is not the answer; the
        // card is.
        setProposal(event.proposal);
        rememberCard(event.proposal.proposalId);
        setStatus(null);
        progressRef.current = "";
        setProgress("");
        break;
      case "clarify":
        setClarify(event.clarify);
        setStatus(null);
        progressRef.current = "";
        setProgress("");
        break;
      case "error":
        setAnswer("");
        progressRef.current = "";
        setProgress("");
        setError(event.error);
        setStatus(null);
        break;
    }
  }

  /** Clears everything a previous question produced. A pending card is
   * withdrawn on the server too, so it cannot be confirmed later from a
   * stale tab. */
  function clearResult() {
    if (proposal && !outcome) void cancelAskProposal(proposal.proposalId);
    rememberCard(null);
    setAnswer("");
    setCitations([]);
    setError(null);
    setProposal(null);
    setClarify(null);
    setOutcome(null);
    setTapError(null);
  }

  async function send(request: AskRequest, shown: string) {
    // A question already in flight is abandoned rather than blocking this
    // one. Previously the input stayed enabled while the button was
    // disabled, so pressing Return mid-answer did nothing at all — no new
    // question, no feedback. Waiting ten seconds to be allowed to ask
    // something else is not a feature.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    clearResult();
    setAsked(shown);
    // Deliberately not "Reading your records…". At this point nothing has
    // been read and nothing may be: a question this app cannot answer
    // spends its whole wait behind that sentence, which is then a false
    // claim for the entire time a person is looking at it. The `tools`
    // event says what is actually being read, once something is.
    setStatus("Thinking…");
    progressRef.current = "";
    setProgress("");
    provisionalRef.current = true;
    setIsAsking(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        setError("The assistant is unavailable right now. Try again shortly.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // One JSON object per line. A chunk can split a line anywhere, so
        // the trailing fragment stays in the buffer until its newline
        // arrives — parsing it early would throw on valid output.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            apply(JSON.parse(line) as AskStreamEvent);
          } catch {
            // A malformed line is a bug on our side; dropping it beats
            // killing an answer that is otherwise arriving fine.
          }
        }
      }
    } catch (err) {
      // An abort is us, not a failure — the next question is already
      // running and owns the panel now.
      if ((err as { name?: string }).name !== "AbortError") {
        setError("The assistant is unavailable right now. Try again shortly.");
      }
    } finally {
      if (abortRef.current === controller) {
        setIsAsking(false);
        setStatus(null);
      }
    }
  }

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    void send({ question: trimmed }, trimmed);
  }

  /** A chip: the same question, with the person's pick, and no model pass. */
  function choose(current: ClarifyView, value: string) {
    void send(
      {
        question: asked,
        continuation: {
          command: current.command,
          partialInput: current.partialInput,
          answers: { [current.field]: value },
        },
      },
      asked,
    );
  }

  function confirm(current: ProposalView) {
    setTapError(null);
    startConfirm(async () => {
      const result = await confirmAskProposal(current.proposalId);
      if (result.ok) {
        setOutcome(result.value);
        rememberCard(null);
      } else {
        setTapError(result.error);
      }
    });
  }

  function cancel(current: ProposalView) {
    startConfirm(async () => {
      await cancelAskProposal(current.proposalId);
      setProposal(null);
      setTapError(null);
      rememberCard(null);
    });
  }

  const hasResult =
    answer !== "" || error !== null || proposal !== null || clarify !== null || outcome !== null;

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your jobs, money, drawings, crews — or start an estimate…"
          aria-label="Ask about your jobs"
          maxLength={1000}
          className="min-w-0 flex-1 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          // Disabled while in flight. Every create button in this app got
          // this treatment after a failed page invited a second click; this
          // one writes nothing, so a repeat is only a wasted call — but a
          // button that looks live during a slow answer invites the click
          // that makes it slower.
          disabled={question.trim() === "" || (isAsking && question.trim() === asked)}
          className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAsking && question.trim() === asked ? "Looking…" : "Ask"}
        </button>
      </form>

      {!hasResult && !isAsking && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(example);
                  inputRef.current?.focus();
                  ask(example);
                }}
                className="rounded-full border border-line-card px-3 py-1 text-xs text-ink-body hover:border-link hover:text-link"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(hasResult || isAsking) && (
        <div className="mt-3">
          <p className="text-xs text-ink-body">{asked}</p>

          {/* The status line names what is being read, because a question
              spanning several areas spends most of its time in the
              database and a static message for eight seconds reads as a
              hang rather than as work. */}
          {(status || progress) && (
            <p
              className="mt-1 whitespace-pre-line text-sm text-ink-body"
              data-ask="progress"
              aria-live="polite"
            >
              {progress || status}
            </p>
          )}

          {/* whitespace-pre-line so a list the model writes as lines
              renders as lines. Nothing here is markdown: the answer is
              prose, and giving it a path to markup would be a hole.
              aria-live is polite so a screen reader is not interrupted on
              every token. */}
          {/* Only ever the answer. data-ask makes that checkable from a
              test without depending on Tailwind class names, one of which
              is a prefix of the other. */}
          {answer && (
            <p
              className="mt-1 whitespace-pre-line text-sm text-ink"
              data-ask="answer"
              aria-live="polite"
            >
              {answer}
            </p>
          )}

          {error && (
            <p className="mt-1 text-sm text-tag-rose-ink" aria-live="polite">
              {error}
            </p>
          )}

          {/* A name matched several rows. The chips carry the detail that
              tells them apart, and a tap re-runs the same question with
              the pick — no retyping, no model pass. */}
          {clarify && (
            <div className="mt-2" data-ask="clarify">
              <p className="text-sm text-ink">{clarify.question}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {clarify.options.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      disabled={isAsking}
                      onClick={() => choose(clarify, option.value)}
                      className="inline-flex min-h-11 flex-col items-start rounded-md border border-line-card px-3 py-1.5 text-left hover:border-link disabled:opacity-50"
                    >
                      <span className="text-sm text-ink">{option.label}</span>
                      {option.detail && <span className="text-xs text-ink-body">{option.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {proposal && (
            <AskProposalCard
              proposal={proposal}
              pending={isConfirming}
              error={tapError}
              outcome={outcome}
              onConfirm={() => confirm(proposal)}
              onCancel={() => cancel(proposal)}
              // Leaving for the page the card hands off to. The card is
              // forgotten here rather than cancelled: the page will load
              // it, and the server refuses to reattach an opened card.
              onOpen={() => rememberCard(null)}
            />
          )}

          {/* Citations arrive with the last event, not the first, so they
              appear once the answer is complete. An answer with no tool
              behind it carries none — links under a refusal would imply a
              sourcing that did not happen. */}
          {citations.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-body">
              <span>Read from</span>
              {citations.map((citation) => (
                <Link
                  key={citation.href}
                  href={citation.href}
                  className="underline hover:text-link"
                >
                  {citation.label}
                </Link>
              ))}
            </p>
          )}

          {!isAsking && hasResult && (
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                clearResult();
                setAsked("");
                setQuestion("");
                inputRef.current?.focus();
              }}
              className="mt-2 text-xs text-ink-body underline hover:text-link"
            >
              Ask something else
            </button>
          )}
        </div>
      )}
    </section>
  );
}
