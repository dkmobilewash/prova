"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@prova/ui";
import { markFilesReceived } from "@/lib/actions";
import { DOOR_LABEL, DOORS, type Door } from "@/lib/outbound-scoreboard";

/**
 * "They sent the files" — one press, one NOTE tagged with the door, and the
 * scoreboard's files tile stops reading n/a. The door defaults to the one
 * the lead's latest reply came through and can be changed before pressing,
 * since a pay-app prospect sometimes sends the payroll run instead.
 */
export function FilesReceivedButton({ leadId, door: initial }: { leadId: string; door: Door }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [door, setDoor] = useState<Door>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        aria-label="Which door the files answer"
        value={door}
        onChange={(event) => setDoor(event.target.value as Door)}
        disabled={pending}
        className="rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body"
      >
        {DOORS.map((d) => (
          <option key={d} value={d}>
            {DOOR_LABEL[d]}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await markFilesReceived(leadId, door);
            setMessage(result.ok ? { ok: true, text: "Files received — logged." } : { ok: false, text: result.error });
            if (result.ok) router.refresh();
          });
        }}
      >
        {pending ? "Logging…" : "Files received"}
      </Button>
      {message ? <span className={`text-xs ${message.ok ? "text-ink-body" : "text-danger"}`}>{message.text}</span> : null}
    </span>
  );
}
