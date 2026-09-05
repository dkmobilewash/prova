"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeContacts } from "@/lib/actions";
import type { MergeChoice, MergeChoices, MergeableFieldKey } from "@/lib/contact-merge";

/** One field the merge would change, already decided by the SAME function the
 * action runs — computed on the server from the two real rows, so what this
 * screen shows and what the merge does cannot drift apart. */
export type MergeFieldPreview = {
  key: MergeableFieldKey;
  label: string;
  keep: string | null;
  duplicate: string | null;
};

export type MergeCandidate = {
  id: string;
  name: string;
  jobs: number;
  bidInvitations: number;
  interactions: number;
  people: number;
  hasPortalLink: boolean;
  hasQuickBooksLink: boolean;
  /** Blank on the contact being kept; the duplicate's value fills them in. */
  fills: MergeFieldPreview[];
  /** Set differently on both. Each needs an answer before merging. */
  conflicts: MergeFieldPreview[];
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function MergeContactForm({
  winnerId,
  winnerName,
  winnerHasQuickBooksLink,
  candidates,
}: {
  winnerId: string;
  winnerName: string;
  winnerHasQuickBooksLink: boolean;
  candidates: MergeCandidate[];
}) {
  const [loserId, setLoserId] = useState("");
  const [choices, setChoices] = useState<MergeChoices>({});
  const [isArmed, setIsArmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  const loser = useMemo(
    () => candidates.find((c) => c.id === loserId) ?? null,
    [candidates, loserId],
  );

  const unanswered = loser ? loser.conflicts.filter((c) => !choices[c.key]) : [];
  const bothLinkedToQuickBooks = Boolean(loser?.hasQuickBooksLink && winnerHasQuickBooksLink);

  function pick(id: string) {
    setLoserId(id);
    setChoices({});
    setIsArmed(false);
    setError(null);
    setDone(null);
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        {winnerName} is the only contact on file, so there is nothing to merge into it.
      </p>
    );
  }

  return (
    <div className="text-sm">
      <p className="mb-4 text-slate-400">
        Opening a job types the GC&apos;s name in fresh, so the same builder can end up on this
        list more than once — and their jobs, bids, payment history and contract terms end up
        split between the copies. Pick the duplicate below and it is folded into {winnerName}.
      </p>

      <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500" htmlFor="merge-loser">
        Duplicate to fold in
      </label>
      <select
        id="merge-loser"
        value={loserId}
        disabled={isArmed || isPending}
        onChange={(event) => pick(event.target.value)}
        className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-50"
      >
        <option value="">Choose a contact…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {plural(c.jobs, "job", "jobs")}, {plural(c.bidInvitations, "bid", "bids")}
          </option>
        ))}
      </select>

      {loser && (
        <>
          <div className="mb-4 rounded-md border border-slate-800 bg-slate-950 p-4">
            <p className="mb-2 font-medium text-slate-200">
              What moves from {loser.name} to {winnerName}
            </p>
            <ul className="space-y-1 text-slate-300">
              <li>{plural(loser.jobs, "job", "jobs")}</li>
              <li>{plural(loser.bidInvitations, "bid invitation", "bid invitations")}</li>
              <li>{plural(loser.interactions, "logged interaction", "logged interactions")}</li>
              <li>{plural(loser.people, "person on file", "people on file")}</li>
              <li>
                {loser.hasQuickBooksLink
                  ? "its QuickBooks customer link"
                  : "no QuickBooks customer link"}
              </li>
            </ul>
            <p className="mt-3 text-slate-400">
              {loser.name}&apos;s record is then deleted. {winnerName} keeps its own name and
              status.
            </p>
          </div>

          {bothLinkedToQuickBooks && (
            <p className="mb-4 rounded-md border border-red-900 bg-red-950/40 p-3 text-red-300">
              Both contacts are linked to different QuickBooks customers. Merge those two
              customers inside QuickBooks first, or unlink one here — this merge will refuse
              until then, rather than strand one of them.
            </p>
          )}

          {loser.fills.length > 0 && (
            <div className="mb-4">
              <p className="mb-1 font-medium text-slate-200">
                Blank on {winnerName} — filled in from {loser.name}
              </p>
              <ul className="space-y-1 text-slate-300">
                {loser.fills.map((f) => (
                  <li key={f.key}>
                    {f.label}: <span className="text-green-300">{f.duplicate}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loser.conflicts.length > 0 && (
            <div className="mb-4">
              <p className="mb-1 font-medium text-slate-200">
                Filled in differently on both — pick the one to keep
              </p>
              <p className="mb-3 text-slate-400">
                Nothing is chosen for you. These are contract terms; the wrong one silently
                surviving is how a pay app comes out short.
              </p>
              <ul className="space-y-3">
                {loser.conflicts.map((c) => (
                  <li key={c.key}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">{c.label}</p>
                    <div className="flex flex-wrap gap-4">
                      {(
                        [
                          ["keep", winnerName, c.keep],
                          ["duplicate", loser.name, c.duplicate],
                        ] as Array<[MergeChoice, string, string | null]>
                      ).map(([side, owner, value]) => (
                        <label key={side} className="flex items-center gap-2 text-slate-300">
                          <input
                            type="radio"
                            name={`merge-choice-${c.key}`}
                            value={side}
                            disabled={isArmed || isPending}
                            checked={choices[c.key] === side}
                            onChange={() => setChoices((prev) => ({ ...prev, [c.key]: side }))}
                          />
                          <span>
                            {value} <span className="text-slate-500">({owner})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loser.hasPortalLink && (
            <p className="mb-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-amber-300">
              {loser.name} has a client portal link out there. Merging kills it — anyone holding
              that URL will get a &ldquo;not found&rdquo; page. It is never moved onto{" "}
              {winnerName}, because that would hand whoever has the old link everything{" "}
              {winnerName} can see. Issue a fresh link from this page afterwards if they need one.
            </p>
          )}

          <p className="mb-3 text-slate-400">
            This cannot be undone. There is no un-merge — the duplicate&apos;s record is gone
            afterwards.
          </p>

          {isArmed ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-300">
                Fold {loser.name} into {winnerName} and delete it?
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await mergeContacts(loser.id, winnerId, {
                        choices,
                        expected: {
                          jobs: loser.jobs,
                          bidInvitations: loser.bidInvitations,
                          interactions: loser.interactions,
                          people: loser.people,
                        },
                      });
                      if (!result.ok) {
                        setError(result.error);
                        setIsArmed(false);
                        return;
                      }
                      const v = result.value;
                      setDone(
                        `Merged. Moved ${plural(v.jobs, "job", "jobs")}, ` +
                          `${plural(v.bidInvitations, "bid invitation", "bid invitations")}, ` +
                          `${plural(v.interactions, "interaction", "interactions")}, ` +
                          `${plural(v.people, "person", "people")}` +
                          (v.quickBooksLinks > 0 ? ", and the QuickBooks customer link" : "") +
                          (v.fieldsFilled.length > 0
                            ? `. Filled in: ${v.fieldsFilled.join(", ")}`
                            : "") +
                          (v.fieldsOverwritten.length > 0
                            ? `. Replaced with the duplicate's: ${v.fieldsOverwritten.join(", ")}`
                            : "") +
                          (v.portalLinkRevoked ? ". The duplicate's portal link is now dead." : ""),
                      );
                      setIsArmed(false);
                      setLoserId("");
                      setChoices({});
                      router.refresh();
                    } catch {
                      setError("Could not merge these contacts");
                      setIsArmed(false);
                    }
                  });
                }}
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Merging…" : "Confirm merge"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsArmed(false)}
                className={btn}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={unanswered.length > 0 || bothLinkedToQuickBooks}
              onClick={() => {
                setError(null);
                setDone(null);
                setIsArmed(true);
              }}
              className={btn}
              title={
                unanswered.length > 0
                  ? `Choose a value for: ${unanswered.map((c) => c.label).join(", ")}`
                  : undefined
              }
            >
              Merge {loser.name} into {winnerName}
            </button>
          )}

          {unanswered.length > 0 && !isArmed && (
            <p className="mt-2 text-xs text-slate-500">
              Choose a value for: {unanswered.map((c) => c.label).join(", ")}
            </p>
          )}
        </>
      )}

      {error && <p className="mt-3 text-red-400">{error}</p>}
      {done && <p className="mt-3 text-green-300">{done}</p>}
    </div>
  );
}
