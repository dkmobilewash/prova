"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findEmailForOneLead } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";

const SOURCE_WORDS: Record<string, string> = {
  site: "printed on their own website",
  pattern: "guessed from the owner's name",
  caller: "typed in by hand",
};

/**
 * ONE LEAD: FIND AN EMAIL, AND SAY HOW IT WAS FOUND.
 *
 * Once the lead has an email the button is gone — the finder never overwrites
 * one — and what shows instead is where that address came from and whether
 * anything verified it, because "guessed" and "printed on their site" must not
 * look the same to the person about to send to it.
 */
export function FindEmailButton({
  leadId,
  website,
  email,
  emailSource,
  verified,
}: {
  leadId: string;
  website: string | null;
  email: string | null;
  emailSource: string | null;
  verified: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (email) {
    return (
      <p className="mt-3 text-xs text-ink-muted">
        {email}
        {emailSource ? ` — ${SOURCE_WORDS[emailSource] ?? emailSource}` : ""}
        {emailSource === "caller" ? "" : verified ? ", verified." : ", not verified."}
        {website ? ` Website: ${website}.` : ""}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setNote(null);
          setError(null);
          startTransition(async () => {
            const result = await findEmailForOneLead(leadId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setNote(result.value.note);
            router.refresh();
          });
        }}
        className="inline-flex items-center rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-body hover:bg-canvas disabled:opacity-50"
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Looking for an email…
          </span>
        ) : (
          "Find email"
        )}
      </button>
      {website && !note ? <span className="text-xs text-ink-muted">Website: {website}</span> : null}
      {note ? <p className="text-xs text-ink-body">{note}</p> : null}
      {error ? <p className="text-xs text-tag-rose-ink">{error}</p> : null}
    </div>
  );
}
