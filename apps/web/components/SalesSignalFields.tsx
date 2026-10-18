"use client";

import {
  SALES_SIGNAL_KINDS,
  type SalesSignalKind,
} from "@/lib/sales-qualification";

/**
 * The create and edit halves of a signal, in ONE component.
 *
 * List-page convention in this app: one shared `*Fields` for create and edit,
 * so the two can never disagree about what a record is. See CLAUDE.md's list
 * page rules.
 *
 * `kind` is editable on create and absent on edit, which is not an oversight:
 * a signal is an evidence record and its identity fields lock after creation.
 * Changing what a claim is ABOUT turns it into a different signal, and the
 * honest move is to dismiss this one and add that one — which also leaves the
 * dismissal behind as the memory that stops a search re-proposing it.
 */

/** Human labels, in the order the band cares about them. The last two are the
 *  ones that give you an opening sentence. */
export const SIGNAL_KIND_LABELS: Record<SalesSignalKind, string> = {
  TRADE: "What they do",
  SIZE: "How big they are",
  GEOGRAPHY: "Where they work",
  LICENCE: "Licence or registration",
  UNION: "Union status",
  TECH: "Software they already run",
  GC_RELATIONSHIP: "A GC they work under",
  PROJECT: "A job they are on",
};

const field =
  "mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted";
const label = "text-xs font-medium text-ink-label";

export function SalesSignalFields({
  signal,
  includeKind = true,
}: {
  signal?: {
    kind?: string;
    claim?: string;
    sourceUrl?: string;
    sourceTitle?: string | null;
    disqualifies?: boolean;
  };
  includeKind?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {includeKind && (
        <label className="block sm:col-span-1">
          <span className={label}>What this tells you</span>
          <select
            name="kind"
            defaultValue={signal?.kind ?? "TRADE"}
            className={field}
            required
          >
            {SALES_SIGNAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SIGNAL_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label
        className={`block ${includeKind ? "sm:col-span-1" : "sm:col-span-2"}`}
      >
        <span className={label}>Where you read it</span>
        <input
          type="url"
          name="sourceUrl"
          defaultValue={signal?.sourceUrl ?? ""}
          placeholder="https://…"
          className={field}
          required
        />
        {/* Said on the form rather than only in the refusal, because the
            refusal arrives after somebody has typed the whole thing. */}
        <span className="mt-1 block text-xs text-ink-muted">
          Required. Without a source this is a rumour, and it will be read as a
          fact on a call.
        </span>
      </label>

      <label className="block sm:col-span-2">
        <span className={label}>What you found</span>
        <input
          type="text"
          name="claim"
          defaultValue={signal?.claim ?? ""}
          placeholder="Framing the Mission Valley medical office under Swinerton"
          className={field}
          required
        />
        <span className="mt-1 block text-xs text-ink-muted">
          One sentence, the way you would say it on the phone.
        </span>
      </label>

      <label className="block sm:col-span-2">
        <span className={label}>What the page is called (optional)</span>
        <input
          type="text"
          name="sourceTitle"
          defaultValue={signal?.sourceTitle ?? ""}
          placeholder="Sacramento Business Journal — contract awards"
          className={field}
        />
      </label>

      {includeKind && (
        <label className="flex items-start gap-2 sm:col-span-2">
          <input
            type="checkbox"
            name="disqualifies"
            defaultChecked={signal?.disqualifies ?? false}
            className="mt-0.5 h-4 w-4 rounded border-line-card bg-surface"
          />
          <span className="text-xs text-ink-body">
            <span className="font-medium text-ink-label">
              This rules them out.
            </span>{" "}
            They are the general contractor, they have shut down, they already
            pay us, or they are locked into a competitor. Confirmed, this ends
            the chase whatever else you know.
          </span>
        </label>
      )}
    </div>
  );
}
