"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { dismissAlert, restoreAlert, snoozeAlert } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import type { Alert } from "@/lib/alerts";
import { inputClass, labelClass } from "@/components/RfiFields";
import { kindLabel, severityBadgeClass, severityLabel } from "@/components/alertLabels";
import { money } from "@/lib/money";

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

/** One alert, with the two things a person can do about it that this app
 * can honestly record: go and fix it, or say they have seen it.
 *
 * "Dismiss" is deliberately not called "resolve". Nothing here changes the
 * situation the alert is about — dismissing an expiring licence does not
 * renew it, and the alert comes back the moment the date moves, because
 * the key carries the date. Calling it resolve would promise otherwise. */
export function AlertRow({ alert, silenced }: { alert: Alert; silenced: boolean }) {
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${severityBadgeClass(alert.severity)}`}>
            {severityLabel(alert.severity)}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
            {kindLabel(alert.kind)}
          </span>
          <span className="text-slate-100">{alert.title}</span>
          {alert.amount !== null && alert.amount > 0 && (
            <span className="font-mono text-sm text-slate-300">{money(alert.amount)}</span>
          )}
        </div>

        <p className="mt-1 text-sm text-slate-400">{alert.detail}</p>

        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}

        {isSnoozing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              run(() => snoozeAlert(alert.key, formData), () => setIsSnoozing(false));
            }}
            className="mt-3 flex flex-col gap-2"
          >
            <label className={labelClass}>
              Remind me again on
              <input type="date" name="snoozeUntil" required className={inputClass} />
              <span className="text-xs text-slate-500">
                It comes back sooner than this if the situation changes — the reminder is keyed to the
                date on the record, so renewing or answering it clears this by itself.
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Snooze"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsSnoozing(false)}
                className={btn}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={alert.href}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          Go and fix it
        </Link>

        {silenced ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => restoreAlert(alert.key))}
            className={btn}
          >
            Put it back
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsSnoozing((open) => !open);
                setError(null);
              }}
              className={btn}
            >
              Snooze
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => dismissAlert(alert.key))}
              className={btn}
            >
              Seen it
            </button>
          </>
        )}
      </div>
    </li>
  );
}
