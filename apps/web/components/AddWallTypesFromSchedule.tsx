"use client";

import { useState, useTransition } from "react";
import { addWallTypesFromSchedule } from "@/lib/actions";

/**
 * ── THE ONE BUTTON THAT JOINS A DRAWING TO A PRICE ──
 *
 * The wall finder measures thickness off the sheet and knows nothing else about
 * a wall. The wall-type library knows the assembly and the price and nothing
 * about thickness. This button is where a partition schedule supplies the
 * missing half, for every wall on the sheet rather than the 25-43% an architect
 * happened to tag.
 *
 * ── IT SAYS WHAT IT WILL DO BEFORE IT DOES IT, AND WHAT IT DID AFTERWARDS ──
 *
 * Both halves matter here. The count is on the button, so pressing it is not a
 * leap; and the result names the codes that landed, the codes it refused
 * because they are already in the library, and the rows it could not read a
 * thickness from. That last number is the one somebody would otherwise never
 * learn: a schedule of six read as four is two wall types quietly missing, and
 * nothing else on this screen would say so.
 */
export function AddWallTypesFromSchedule({
  jobId,
  proposalId,
  count,
}: {
  jobId: string;
  proposalId: string;
  /** How many rows the reading holds — the upper bound on what can land. */
  count: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-3 flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await addWallTypesFromSchedule(jobId, proposalId);
            setMessage(result.ok ? sentence(result.value) : result.error);
          })
        }
        className="min-h-[36px] rounded-md border border-brand bg-tag-brand px-3 text-xs font-medium text-tag-brand-ink hover:opacity-90 disabled:opacity-50"
      >
        {isPending
          ? "Adding…"
          : `Add these as wall types — ${count} ${count === 1 ? "row" : "rows"}`}
      </button>
      <p className="text-xs text-ink-muted">
        Each one arrives with its thickness, so a wall measured on the drawing can find it. You still add your own
        parts and prices.
      </p>
      {message !== null && <p className="text-sm text-ink-body">{message}</p>}
    </div>
  );
}

/** What landed, what did not, and what could not be read — in that order,
 *  because the first is the answer and the other two are the exceptions. */
function sentence(value: { added: string[]; taken: string[]; unread: number }): string {
  const parts = [`Added ${value.added.join(", ")}. Open Wall types to put your own parts and prices on them.`];
  if (value.taken.length > 0) {
    parts.push(
      `${value.taken.join(", ")} ${value.taken.length === 1 ? "was" : "were"} already in your library and ` +
        `${value.taken.length === 1 ? "was" : "were"} left alone — a tag means different things on different jobs.`,
    );
  }
  if (value.unread > 0) {
    parts.push(
      `${value.unread} ${value.unread === 1 ? "row" : "rows"} gave no thickness that could be read, so ` +
        `${value.unread === 1 ? "it was" : "they were"} skipped. Add ${value.unread === 1 ? "that one" : "those"} by hand.`,
    );
  }
  return parts.join(" ");
}
