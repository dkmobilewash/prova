"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteBackcharge,
  disputeBackcharge,
  reopenBackcharge,
  resolveBackcharge,
  updateBackcharge,
} from "@/lib/actions";
import { BackchargeFields, type BackchargeDefaults } from "@/components/BackchargeFields";
import { inputClass, labelClass } from "@/components/RfiFields";
import { categoryLabel, statusBadgeClass, statusLabel } from "@/components/backchargeLabels";
import { concededAmount, daysToRespond, isResponseOverdue } from "@/lib/backcharges";
import { localToday } from "@/components/localToday";
import { money } from "@/lib/money";

export type BackchargeRowData = BackchargeDefaults & {
  id: string;
  number: number;
  jobName: string;
  status: string;
  disputedOn: string | null;
  disputeReason: string | null;
  resolvedOn: string | null;
  resolvedAmount: number | null;
  resolutionNote: string | null;
  loggedByName: string | null;
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function BackchargeRow({
  backcharge,
  today,
  canDelete,
  showJob,
}: {
  backcharge: BackchargeRowData;
  today: string;
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "dispute" | "resolve">("view");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("SETTLED");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, fallback: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          setError(result.error);
        } else {
          // On top of the action's own revalidatePath. Browser testing found
      // two union-compliance forms leaving the page stale until a manual
      // reload while others updated live; every action revalidates and
      // every form calls them the same way, so this is NOT a root-cause
      // fix. It is applied here because these components share that exact
      // pattern, and the same bug would sit unseen until someone hit it.
      // A save that looks like it did nothing gets clicked again, and no
      // create action here is idempotent.
          router.refresh();
          setMode("view");
        }
      } catch {
        setError(fallback);
      }
    });
  }

  const unresolved = backcharge.status === "RECEIVED" || backcharge.status === "DISPUTED";
  const claimed = Number(backcharge.claimedAmount);

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updateBackcharge(backcharge.id, formData), "Could not save changes");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            Backcharge {backcharge.number} · {backcharge.jobName}
          </p>
          <BackchargeFields defaults={backcharge} locked={backcharge.status !== "RECEIVED"} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "dispute") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => disputeBackcharge(backcharge.id, formData), "Could not record the objection");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            Object to backcharge {backcharge.number} — {money(claimed)}
          </p>

          <label className={labelClass}>
            Grounds for the objection
            <textarea
              name="disputeReason"
              required
              rows={3}
              placeholder="What we told them, as we told them — e.g. 'debris was the demo contractor's; our crew was off site from the 12th, see daily reports'"
              className={inputClass}
            />
          </label>

          <label className={labelClass}>
            Date we objected in writing
            <input type="date" name="disputedOn" defaultValue={localToday()} className={inputClass} />
            <span className="text-xs text-slate-500">
              The date the letter or email went out. It&apos;s the only thing that proves we answered
              in time.
            </span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Record objection"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "resolve") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => resolveBackcharge(backcharge.id, formData), "Could not resolve it");
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">
            Close out backcharge {backcharge.number} — claimed {money(claimed)}
          </p>

          <label className={labelClass}>
            How it ended
            <select
              name="outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              className={inputClass}
            >
              <option value="SETTLED">Settled at a lower figure</option>
              <option value="ACCEPTED">Accept in full</option>
              <option value="WITHDRAWN">The GC withdrew it</option>
            </select>
          </label>

          {outcome === "SETTLED" && (
            <label className={labelClass}>
              Amount settled at
              <input
                type="number"
                name="resolvedAmount"
                required
                step="0.01"
                min="0.01"
                max={claimed}
                placeholder="0.00"
                className={inputClass}
              />
              <span className="text-xs text-slate-500">
                The negotiated figure. Accepting the full {money(claimed)} is &ldquo;Accept in
                full&rdquo; — the two aren&apos;t the same record.
              </span>
            </label>
          )}

          <label className={labelClass}>
            Date it was resolved
            <input type="date" name="resolvedOn" defaultValue={localToday()} className={inputClass} />
          </label>

          <label className={labelClass}>
            Note
            <textarea
              name="resolutionNote"
              rows={2}
              placeholder="Optional — how it was agreed, and with whom"
              className={inputClass}
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Record outcome"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const overdue = isResponseOverdue(backcharge, today);
  const daysLeft = daysToRespond(backcharge, today);
  const conceded = concededAmount({
    status: backcharge.status,
    claimedAmount: claimed,
    resolvedAmount: backcharge.resolvedAmount,
  });

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-500">BC {backcharge.number}</span>
          <span className="font-mono text-slate-100">{money(claimed)}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${statusBadgeClass(backcharge.status)}`}>
            {statusLabel(backcharge.status)}
          </span>
          {overdue && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
              Past the deadline to object
            </span>
          )}
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
            {categoryLabel(backcharge.category)}
          </span>
        </div>

        <p className="mt-1 text-sm text-slate-300">{backcharge.description}</p>

        {backcharge.disputeReason && (
          <p className="mt-2 border-l-2 border-blue-800 pl-3 text-sm text-slate-400">
            <span className="text-slate-500">We objected{backcharge.disputedOn ? ` ${backcharge.disputedOn}` : ""}: </span>
            {backcharge.disputeReason}
          </p>
        )}

        {!unresolved && (
          <p className="mt-2 border-l-2 border-slate-700 pl-3 text-sm text-slate-400">
            {conceded === null ? (
              <span className="text-amber-300">
                Settled, but no figure was recorded — what this cost us is unknown, so it isn&apos;t in
                the totals above.
              </span>
            ) : (
              <>
                Cost us <span className="font-mono text-slate-200">{money(conceded)}</span>
                {conceded < claimed && <> · {money(claimed - conceded)} argued off</>}
              </>
            )}
            {backcharge.resolutionNote && <span className="text-slate-500"> — {backcharge.resolutionNote}</span>}
          </p>
        )}

        <p className="mt-1 text-xs text-slate-500">
          {showJob && <span className="text-blue-400">{backcharge.jobName} · </span>}
          issued {backcharge.issuedOn ?? "—"}
          {backcharge.receivedOn && ` · received ${backcharge.receivedOn}`}
          {backcharge.respondByDate
            ? ` · object by ${backcharge.respondByDate}${
                daysLeft !== null && daysLeft >= 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""
              }`
            : " · no deadline to object recorded"}
          {backcharge.resolvedOn && ` · resolved ${backcharge.resolvedOn}`}
        </p>
        <p className="text-xs text-slate-500">
          {backcharge.gcReference && `their ref ${backcharge.gcReference}`}
          {backcharge.loggedByName &&
            `${backcharge.gcReference ? " · " : ""}logged by ${backcharge.loggedByName}`}
        </p>

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {backcharge.status === "RECEIVED" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode("dispute")}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Object
          </button>
        )}

        {unresolved && (
          <button type="button" disabled={isPending} onClick={() => setMode("resolve")} className={btn}>
            Close out
          </button>
        )}

        {!unresolved && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => reopenBackcharge(backcharge.id), "Could not reopen it")}
            className={btn}
          >
            Reopen
          </button>
        )}

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setMode("edit");
            setIsConfirmingDelete(false);
          }}
          className={btn}
        >
          Edit
        </button>

        {canDelete &&
          backcharge.status === "RECEIVED" &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deleteBackcharge(backcharge.id), "Could not delete it")}
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className={btn}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className={btn}
            >
              Delete
            </button>
          ))}
      </div>
    </li>
  );
}
