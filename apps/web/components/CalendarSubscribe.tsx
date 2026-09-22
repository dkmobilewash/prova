"use client";

import { useEffect, useState, useTransition } from "react";
import { ensureCalendarFeedToken, regenerateCalendarFeedToken } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * "Subscribe in your calendar" on /schedule: the one place a person's
 * calendar-feed URL is created, shown, copied and rotated.
 *
 * The URL is built from `window.location.origin` in an effect, never
 * during render — the server does not know which host the browser is on
 * (production, a preview, a laptop), and rendering one host's URL into
 * markup served from another is a hydration mismatch waiting to happen.
 *
 * Regenerate is the two-step ConfirmDelete control, because it IS
 * destructive: every calendar already subscribed to the old URL silently
 * stops updating the moment it commits.
 */
export function CalendarSubscribe({ token: initialToken }: { token: string | null }) {
  const [token, setToken] = useState(initialToken);
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = token && origin ? `${origin}/api/calendar/${token}` : null;

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await ensureCalendarFeedToken();
      if (result.ok) setToken(result.value);
      else setError(result.error);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link text and copy it yourself.");
    }
  }

  return (
    <section className="mb-10 rounded-lg border border-line-card bg-surface p-4" data-tour="schedule-subscribe">
      <h2 className="text-sm font-semibold text-ink-label">Subscribe in your calendar</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-body">
        Put the crew schedule on your phone&rsquo;s calendar. It updates by itself — each planned day
        shows as an all-day event with the job, who&rsquo;s on it, and the site address. The link is
        yours alone; anyone holding it can read the schedule, so treat it like a key.
      </p>

      {!token ? (
        <button
          type="button"
          onClick={create}
          disabled={isPending}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-line-card bg-surface px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800 disabled:opacity-60"
        >
          {isPending ? "Creating…" : "Create my calendar link"}
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              data-testid="calendar-feed-url"
              className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line-card bg-surface-sunken px-3 py-2 text-xs text-ink-body"
            >
              {url ?? "…"}
            </code>
            <button
              type="button"
              onClick={copy}
              disabled={!url}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-line-card bg-surface px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800 disabled:opacity-60"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            iPhone: Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add
            Subscribed Calendar, paste the link. Google Calendar: Other calendars → + → From URL.
            Outlook: Add calendar → Subscribe from web. Calendar apps refresh on their own schedule —
            usually within a few hours.
          </p>
          <RowActions
            className="flex items-center gap-2"
            destructive={
              <ConfirmDelete
                label="Regenerate"
                confirmLabel="Confirm regenerate"
                pendingLabel="Regenerating…"
                describe="Replaces this link with a new one. Every calendar subscribed to the old link stops updating until you paste the new one in."
                pending={isPending}
                pinned="start"
                onConfirm={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await regenerateCalendarFeedToken();
                    if (result.ok) setToken(result.value);
                    else setError(result.error);
                  });
                }}
                armedClassName="flex flex-wrap items-center gap-2"
                hint={
                  <span className="text-ink-muted">
                    The old link stops working the moment you confirm.
                  </span>
                }
              />
            }
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
