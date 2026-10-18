"use client";

import { useState, useTransition } from "react";
import { Button } from "@prova/ui";
import { runPublicWorksSyncNow } from "@/lib/actions/publicWorks";

/** Pulls the stalest slice of the public record and says what arrived. Disabled
 * while a pull is in flight: a second press would start a second 40-second
 * pull, and the first one's rows would still be the ones on screen. */
export function PublicWorksSyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runPublicWorksSyncNow();
            setMessage(result.ok ? { ok: true, text: result.summary } : { ok: false, text: result.error });
          })
        }
      >
        {pending ? "Pulling from CSLB and DIR…" : "Pull the next slice now"}
      </Button>
      {message && <p className={`text-xs ${message.ok ? "text-ink-muted" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
