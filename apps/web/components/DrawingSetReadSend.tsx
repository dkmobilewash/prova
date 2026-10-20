"use client";

import { useState, useTransition } from "react";

import { Spinner } from "@/components/Spinner";
import { sendDrawingSetRead } from "@/lib/actions/takeoffOffer";

/**
 * THE ONE CONTROL THAT MAILS A FREE DRAWING-SET READ TO A PROSPECT.
 *
 * The page it sits on (`/sales/[id]/drawing-read`) is a server component and
 * composes the same subject and body for the operator to read first, so this
 * component holds no copy of the email and no opinion about what it says.
 * Every sentence in the mail belongs to `lib/takeoff-delivery.ts`.
 *
 * ── `onSubmit`, NOT THE `action` PROP ──
 *
 * React 19's `<form action={fn}>` calls `requestFormReset` UNCONDITIONALLY
 * before running the action, so a returned refusal lands over fields that have
 * already snapped back — `components/formActionCensus.test.ts` fails the build
 * on it and its header has the mechanism.
 *
 * There are no typed fields here to lose, which makes it tempting to reach for
 * the prop anyway. The reason not to is that this form's RESULT is the
 * payload: `sendDrawingSetRead` returns the composed text on every success,
 * including the ones that could not send, and that has to survive the submit
 * and be rendered. `onSubmit` + `preventDefault` + `new FormData(...)` is the
 * house shape (`components/LogTimeEntryForm.tsx` is the reference) and it is
 * the one that keeps a returned value.
 *
 * The two ids go through the FormData rather than straight off the props for
 * the reason that file gives: what is submitted is then exactly what was
 * RENDERED, not whatever a later re-render replaced it with mid-flight.
 *
 * ── THE BUTTON IS DISABLED FOR THE WHOLE ROUND TRIP ──
 *
 * `useFormStatus` reads the `action`-prop transition, so the pending state is
 * this component's own `useTransition`. CLAUDE.md: a page that fails after a
 * commit invites a second click and #19 disabled 57 create buttons for it. A
 * second click here is a second EMAIL at a prospect who has never heard of us,
 * plus a second EMAIL activity on the lead — a false record of correspondence
 * that happened once.
 *
 * ── A FAILED SEND IS NOT A FAILED ACTION, AND THIS IS THE HALF THAT MATTERS ──
 *
 * `{ ok: true, value: { sent: false, problem } }` means this install could not
 * put the mail on the wire — no address on the lead, no mail provider, the
 * provider refused — and the TEXT WAS STILL PRODUCED. The valuable half of the
 * feature is the read, so that branch renders the problem sentence and the
 * exact composed text for the operator to paste into their own mail client.
 * Reporting it as a failure would throw away the thing that works in order to
 * announce the thing that did not.
 *
 * The text rendered on that branch is the action's OWN return value rather
 * than the copy the page composed, deliberately: those are two reads of the
 * database and the one the send attempt produced is the one the prospect is
 * owed.
 */
export function DrawingSetReadSend({ leadId, planId }: { leadId: string; planId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<{
    sent: boolean;
    subject: string;
    body: string;
    problem: string | null;
  } | null>(null);

  if (sentResult?.sent) {
    return (
      <div className="rounded-md border border-line-card bg-tag-green p-4">
        <p className="text-sm font-semibold text-tag-green-ink">Sent.</p>
        <p className="mt-1 text-sm leading-relaxed text-tag-green-ink">
          The read is on its way, and the send is logged on this lead&rsquo;s activity.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sentResult && sentResult.problem !== null && (
        <div className="rounded-md border border-line-card bg-tag-amber p-4">
          <p className="text-sm font-semibold text-tag-amber-ink">
            Nothing was emailed &mdash; copy the read below and send it yourself.
          </p>
          {/* The provider's or the install's own sentence, rendered as-is.
              `sendDrawingSetRead` promises it is something the operator can
              act on rather than a reason code. */}
          <p className="mt-1 text-sm leading-relaxed text-tag-amber-ink">{sentResult.problem}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-label">
            Subject
          </p>
          <p className="mt-1 break-words font-mono text-sm text-ink">{sentResult.subject}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-label">Body</p>
          {/* `whitespace-pre-wrap` rather than a bare `<pre>`'s overflow: this
              mail is plain text with space-padded columns, and a horizontal
              scrollbar is how a column of sheet numbers gets copied with half
              its rows cut off. */}
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-line-row bg-canvas p-3 font-mono text-xs leading-relaxed text-ink">
            {sentResult.body}
          </pre>
        </div>
      )}

      <form
        onSubmit={(event) => {
          // The reset React would do for us is the whole bug — see the header.
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const lead = String(formData.get("leadId") ?? "");
          const plan = String(formData.get("planId") ?? "");
          setError(null);
          startTransition(async () => {
            try {
              const result = await sendDrawingSetRead(lead, plan);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSentResult(result.value);
            } catch {
              // A thrown Server Action message is redacted to a digest in
              // production, so there is nothing worth showing from it.
              setError("That did not send. Reload the page and check before trying again.");
            }
          });
        }}
      >
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="planId" value={planId} />

        {error && (
          <p role="alert" className="mb-3 text-sm leading-relaxed text-tag-rose-ink">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="min-h-[48px] rounded-md bg-brand px-5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Sending&hellip;
            </span>
          ) : (
            "Email this read to them"
          )}
        </button>
      </form>
    </div>
  );
}
