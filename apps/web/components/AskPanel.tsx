"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { askQuestion } from "@/lib/actions";
import type { AskResult } from "@/lib/ask/answer";

/** The ask box on the dashboard.
 *
 * Deliberately not a chat. There is no thread and no history: a question
 * about this week's money is answered from today's rows, and a scrollback
 * of stale answers is a place for a number to be read long after it stopped
 * being true. Ask, read, ask again.
 */

/** Shown until someone types. Each one is a question this app can actually
 * answer — an example that returns "I don't have that" teaches people the
 * feature does not work. */
const EXAMPLES = [
  "What's overdue and who do I chase first?",
  "Which drawings am I not building to the latest revision of?",
  "What's left on the punch list at Riverside?",
  "Anything expiring I should renew?",
];

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [asked, setAsked] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isPending) return;
    setAsked(trimmed);
    setResult(null);
    startTransition(async () => {
      setResult(await askQuestion(trimmed));
    });
  }

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
          placeholder="Ask about your jobs, money, drawings, crews…"
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
          disabled={isPending || question.trim() === ""}
          className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Looking…" : "Ask"}
        </button>
      </form>

      {!result && !isPending && (
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
                className="rounded-full border border-line-card px-3 py-1 text-xs text-ink-body hover:border-brand hover:text-brand"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}

      {isPending && (
        <p className="mt-3 text-sm text-ink-body" aria-live="polite">
          Reading your {asked ? "records" : "data"}…
        </p>
      )}

      {result && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs text-ink-body">{asked}</p>
          {result.ok ? (
            <>
              {/* whitespace-pre-line so a list the model writes as lines
                  renders as lines. Nothing here is markdown: the answer is
                  prose and rendering it as HTML would be a hole. */}
              <p className="mt-1 whitespace-pre-line text-sm text-ink">{result.answer}</p>
              {result.citations.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-body">
                  {/* The point of these is that a claim can be checked
                      rather than trusted. An answer with no tool behind it
                      carries none. */}
                  <span>Read from</span>
                  {result.citations.map((citation) => (
                    <Link
                      key={citation.href}
                      href={citation.href}
                      className="underline hover:text-brand"
                    >
                      {citation.label}
                    </Link>
                  ))}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-tag-rose-ink">{result.error}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setQuestion("");
              inputRef.current?.focus();
            }}
            className="mt-2 text-xs text-ink-body underline hover:text-brand"
          >
            Ask something else
          </button>
        </div>
      )}
    </section>
  );
}
