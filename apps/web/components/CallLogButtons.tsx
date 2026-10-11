"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logCall } from "@/lib/actions";
import {
  CALL_DISPOSITIONS,
  CALL_DISPOSITION_LABEL,
  type CallDisposition,
} from "@/lib/call-dispositions";
import { Spinner } from "@/components/Spinner";

/**
 * THE ROW OF BUTTONS A CALLER PRESSES WITH THE PHONE STILL IN THE OTHER HAND.
 *
 * One click logs the call as today's CALL activity with its disposition
 * tagged and the cadence's follow-up set (`lib/call-dispositions.ts`). The
 * note is optional and stays in the box until a button is pressed, so a
 * caller can type "asked for Thursday" during the call and tag it after.
 *
 * Every button is disabled while one is in flight — a double click here is
 * two calls logged, and nothing downstream could tell the second from a real
 * one. Same reason `SubmitButton` exists.
 */
export function CallLogButtons({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function log(disposition: CallDisposition) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await logCall(leadId, disposition, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(`Logged: ${CALL_DISPOSITION_LABEL[disposition]}.`);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-line-card bg-canvas p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-ink-body">Log this call</p>
        {pending ? <Spinner /> : null}
      </div>
      <input
        type="text"
        name="note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note, optional — who answered, what they said, when to call back"
        disabled={pending}
        className="mt-2 w-full rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {CALL_DISPOSITIONS.map((disposition) => (
          <button
            key={disposition}
            type="button"
            disabled={pending}
            onClick={() => log(disposition)}
            className={
              disposition === "DO_NOT_CALL"
                ? "rounded-md border border-tag-rose-ink px-3 py-1.5 text-xs font-semibold text-tag-rose-ink disabled:opacity-50"
                : "rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            }
          >
            {CALL_DISPOSITION_LABEL[disposition]}
          </button>
        ))}
      </div>
      {done ? <p className="mt-2 text-xs text-ink-body">{done}</p> : null}
      {error ? <p className="mt-2 text-xs text-tag-rose-ink">{error}</p> : null}
    </div>
  );
}
