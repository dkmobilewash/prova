"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pushLeadsNow } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";

/**
 * ONE BUTTON: SEND TODAY'S NEW LEADS TO THE SMARTLEAD CAMPAIGN NOW, instead of
 * waiting for the 7am run. Same runner, same cap, same rules as the cron.
 *
 * Shaped like `CslbPhoneFill`, for its reason: the result is rendered in
 * words every time, including what was NOT pushed and why, because "pushed 0"
 * means four different things and only the sentence says which. When the
 * keys are not set the panel says so before anyone presses anything.
 */
export function OutboundPushPanel({ candidates, missing }: { candidates: number; missing: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="rounded-md border border-line-card bg-canvas p-4">
      <h3 className="text-sm font-medium text-ink-body">Push new leads to the email sequence</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Every morning at 7am Pacific, leads that are new, have an email and are not marked
        do-not-contact go to the Smartlead campaign, up to the daily cap. This does the same thing
        now.{" "}
        {candidates === 0
          ? "No lead is waiting to be pushed."
          : `${plural(candidates, "lead")} could be pushed, up to the cap.`}
      </p>
      {missing.length > 0 ? (
        <p className="mt-2 text-xs text-tag-rose-ink">
          Not set up: {missing.join(", ")} {missing.length === 1 ? "is" : "are"} not set on this
          deployment, so nothing will be sent — not by this button and not by the 7am run.
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || candidates === 0 || missing.length > 0}
          onClick={() => {
            setDone(null);
            setError(null);
            startTransition(async () => {
              const result = await pushLeadsNow();
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const r = result.value;
              const vendor =
                r.added !== null || r.skipped !== null
                  ? ` Smartlead added ${r.added ?? "?"} and skipped ${r.skipped ?? "?"}.`
                  : "";
              const left = [
                r.excluded.overCap > 0
                  ? `${r.excluded.overCap} waiting for tomorrow (cap ${r.dailyCap} a day, ${r.room} left when this ran)`
                  : null,
                r.excluded.doNotContact > 0 ? `${r.excluded.doNotContact} marked do-not-contact` : null,
                r.excluded.noEmail > 0 ? `${r.excluded.noEmail} with no email` : null,
                r.excluded.notNew > 0 ? `${r.excluded.notNew} already in the sequence or past it` : null,
              ].filter(Boolean);
              setDone(
                `Pushed ${plural(r.sent, "lead")}.${vendor}` +
                  (left.length > 0 ? ` Not pushed: ${left.join("; ")}.` : ""),
              );
              if (r.error) setError(r.error);
              router.refresh();
            });
          }}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {pending ? <Spinner /> : null}
          {pending ? "Pushing…" : "Push leads now"}
        </button>
        {done ? <p className="text-xs text-ink-body">{done}</p> : null}
        {error ? <p className="text-xs text-tag-rose-ink">{error}</p> : null}
      </div>
    </div>
  );
}
