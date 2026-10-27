"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runGuideAction } from "@/lib/actions/bidGuide";
import { primaryActionClass, secondaryActionClass } from "@/components/emptyStateStyles";
import { Spinner } from "@/components/Spinner";
import { isBidPath } from "@/lib/bid/surface";
import type { GuideAction, JobGuide } from "@/lib/bid/guide/types";

/**
 * The ONE thing that needs the person, as a yellow-bordered card: the title,
 * the suggestion, and the buttons.
 *
 * An action with an `href` is a plain `Link` (a real route: Cmd-click works and
 * a refresh lands where you were). An action with an `actionId` is a button that
 * posts to `runGuideAction` — and every one of those WRITES, so pressing it does
 * not run it: it ARMS it, and the whole button row is replaced by
 * [Cancel] [Yes, do it] (CLAUDE.md, "Cancel inherits the delete pixel"). The
 * ordinary actions are hidden while one is armed, Cancel takes the first slot —
 * the stable end of a left-aligned cluster — and below `sm` the pair stacks with
 * Cancel on top, so a hurried second tap costs a tap rather than a write. From
 * `sm` the pair is two EQUAL halves (up to 36rem) rather than two natural
 * widths: measured in Chromium, natural widths put "Yes, do it" under the
 * middle of the 209px primary it replaced, and a hurried second tap there is a
 * write. As halves, Cancel covers the whole span the first button had.
 *
 * At most ONE button is drawn primary (yellow) whatever the guide says: the
 * first action marked `primary` wins and any other is drawn outlined. While a
 * confirm is armed the confirm is the only primary on the card.
 *
 * TAP ANSWERS. An action marked `chip` ("8 ft", "9 ft"…) is drawn in a row of
 * its own above the other buttons, as outlined pills at least 48px tall (a
 * gloved thumb), and is never the primary. A chip WRITES like any action, so it
 * arms the same two-step confirm, and its own `confirm` sentence (when the
 * guide gives one) replaces the general one — a wall type's height reaches past
 * this estimate, and the confirm says so before anything is written.
 *
 * A refusal comes back as a sentence and is shown under the buttons
 * (`role="alert"`); production redacts a thrown message, so the action returns
 * rather than throws. Nothing here computes a figure — the card prints what the
 * guide hands it.
 */
const chipClass =
  "inline-flex min-h-12 min-w-20 items-center justify-center rounded-full border border-line-card px-5 text-sm font-semibold text-ink hover:bg-rail-hover";

export function JobGuideAsk({ guide }: { guide: JobGuide }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ask = guide.ask;
  if (!ask) return null;

  // A link out of Bid is dropped, not drawn: on the Bid host a CRM path would
  // bounce to the Bid home instead of where the button said (bidLinkCensus).
  const actions = ask.actions.filter((action) => !action.href || isBidPath(action.href));
  // A chip is an answer, never the yellow button (types.ts, `chip`).
  const firstPrimary = actions.findIndex((action) => action.primary && !action.chip);
  const chips = actions.map((action, index) => ({ action, index })).filter(({ action }) => action.chip && action.actionId);
  const armedAction: GuideAction | null = armed != null ? (actions[armed] ?? null) : null;

  function confirm(action: GuideAction) {
    if (!action.actionId) return;
    const actionId = action.actionId;
    setError(null);
    startTransition(async () => {
      const result = await runGuideAction(guide.jobId, actionId, action.actionArg);
      if (result.ok) {
        setDone(true);
        setArmed(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section
      aria-labelledby="guide-ask-title"
      data-guide="ask"
      data-ask-id={ask.id}
      className="rounded-lg border border-brand bg-surface p-4 print:hidden sm:p-5"
    >
      <h2 id="guide-ask-title" className="break-words text-base font-semibold text-ink">
        {ask.title}
      </h2>
      {ask.body ? <p className="mt-1 break-words text-sm text-ink-body">{ask.body}</p> : null}

      {armedAction ? (
        <div className="mt-4" data-guide="confirm">
          <p className="mb-2 break-words text-sm text-ink-body">{armedAction.confirm ?? "This changes your estimate. Go ahead?"}</p>
          <div className="flex flex-col gap-2 sm:grid sm:max-w-xl sm:grid-cols-2">
            <button
              type="button"
              className={secondaryActionClass}
              onClick={() => {
                setArmed(null);
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              data-primary="true"
              className={`${primaryActionClass} gap-2 disabled:opacity-60`}
              onClick={() => confirm(armedAction)}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? (
                <>
                  <Spinner />
                  Working…
                </>
              ) : (
                "Yes, do it"
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
        {chips.length > 0 ? (
          <div role="group" aria-label="Answers" className="mt-4 flex flex-wrap gap-2" data-guide="chips">
            {chips.map(({ action, index }) => (
              <button
                key={`${action.label}-${index}`}
                type="button"
                className={chipClass}
                data-chip="true"
                onClick={() => {
                  setDone(false);
                  setError(null);
                  setArmed(index);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-guide="actions">
          {actions.map((action, index) => {
            if (action.chip) return null;
            const primary = index === firstPrimary;
            const className = primary ? primaryActionClass : secondaryActionClass;
            if (action.href) {
              return (
                <Link key={`${action.label}-${index}`} href={action.href} className={className} data-primary={primary ? "true" : undefined}>
                  {action.label}
                </Link>
              );
            }
            return (
              <button
                key={`${action.label}-${index}`}
                type="button"
                className={className}
                data-primary={primary ? "true" : undefined}
                onClick={() => {
                  setDone(false);
                  setError(null);
                  setArmed(index);
                }}
              >
                {action.label}
              </button>
            );
          })}
        </div>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 break-words text-sm text-tag-rose-ink">
          {error}
        </p>
      ) : null}
      {done && !error ? (
        <p role="status" className="mt-3 text-sm text-tag-green-ink">
          Done. The screen is updating.
        </p>
      ) : null}
    </section>
  );
}
