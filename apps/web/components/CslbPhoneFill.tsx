"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fillPhonesFromCslb } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";

/**
 * ONE BUTTON: LOOK UP A PHONE NUMBER FOR EVERY LEAD THAT HAS A LICENCE AND NONE.
 *
 * It is a button rather than part of the import, on purpose. The lookup fetches
 * 77 MB from CSLB's server, which has refused other routes from other machines
 * before; an import that silently came back with no phones would read as "the
 * file has no phones", and the action's own refusal sentence — status and date —
 * is the thing that stops that. So the result is rendered here, in words, every
 * time, including the counts of what did NOT fill and why.
 */
export function CslbPhoneFill({ candidates }: { candidates: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="rounded-md border border-line-card bg-canvas p-4">
      <h3 className="text-sm font-medium text-ink-body">Fill phone numbers from CSLB</h3>
      <p className="mt-1 text-xs text-ink-muted">
        A listing prints a licence number and no telephone. CSLB&rsquo;s free master file has a
        business phone for nearly every licence in good standing. This fills the phone on every
        lead that has a licence and no phone, and leaves everything else alone.{" "}
        {candidates === 0
          ? "Every lead with a licence already has a phone."
          : `${plural(candidates, "lead")} could be filled now.`}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || candidates === 0}
          onClick={() => {
            setDone(null);
            setError(null);
            startTransition(async () => {
              const result = await fillPhonesFromCslb();
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const { filled, notClear, noPhone, noRow, rowsRead } = result.value;
              const leftovers = [
                notClear > 0 ? `${notClear} matched a licence that is not CLEAR and stayed blank` : null,
                noPhone > 0 ? `${noPhone} matched a row with no phone on file` : null,
                noRow > 0 ? `${noRow} had no row in the file` : null,
              ].filter(Boolean);
              setDone(
                `Filled ${plural(filled, "phone")} from ${rowsRead.toLocaleString()} rows` +
                  (leftovers.length > 0 ? `. ${leftovers.join("; ")}` : "") +
                  ".",
              );
              router.refresh();
            });
          }}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {pending ? <Spinner /> : null}
          {pending ? "Reading the CSLB file…" : "Fill phone numbers"}
        </button>
        {done ? <p className="text-xs text-ink-body">{done}</p> : null}
        {error ? <p className="text-xs text-tag-rose-ink">{error}</p> : null}
      </div>
    </div>
  );
}
