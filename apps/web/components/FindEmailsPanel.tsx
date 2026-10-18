"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findEmailsForLeads } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";

/**
 * ONE BUTTON: LOOK FOR AN EMAIL ON THE 25 OLDEST LEADS THAT HAVE NONE.
 *
 * Same shape as `CslbPhoneFill`, and for the same reason: the result is said in
 * words every time, including how many came back as GUESSES and why the empty
 * ones are empty — a batch that quietly found nothing reads as "these firms
 * have no email", when the real answer may be "no search key is set".
 */
export function FindEmailsPanel({ candidates }: { candidates: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="rounded-md border border-line-card bg-canvas p-4">
      <h3 className="text-sm font-medium text-ink-body">Find email addresses</h3>
      <p className="mt-1 text-xs text-ink-muted">
        CSLB publishes no email. This finds each firm&rsquo;s website, reads the addresses it prints,
        and otherwise guesses from the owner&rsquo;s name — verified when a verifier key is set,
        labelled a guess when not. Up to 25 leads per press, oldest first; never overwrites an
        email and skips anyone marked do-not-contact.{" "}
        {candidates === 0 ? "Every lead already has an email." : `${plural(candidates, "lead")} with no email could be looked up now.`}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || candidates === 0}
          onClick={() => {
            setDone(null);
            setError(null);
            startTransition(async () => {
              const result = await findEmailsForLeads(25);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const { found, guessed, none, skipped, reasons } = result.value;
              const parts = [
                `Found ${plural(found, "email")}`,
                guessed > 0 ? `guessed ${guessed} (unverified)` : null,
                none > 0 ? `${none} with none` : null,
                skipped > 0 ? `${skipped} not reached in time — press again` : null,
              ].filter(Boolean);
              const why = reasons.map((r) => `${r.count}× ${r.note}`).join(" ");
              setDone(`${parts.join("; ")}.${why ? ` ${why}` : ""}`);
              router.refresh();
            });
          }}
          className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Looking…
            </span>
          ) : (
            "Find emails"
          )}
        </button>
        {done ? <p className="text-xs text-ink-body">{done}</p> : null}
        {error ? <p className="text-xs text-tag-rose-ink">{error}</p> : null}
      </div>
    </div>
  );
}
