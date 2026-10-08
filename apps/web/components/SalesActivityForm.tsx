"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSalesActivity } from "@/lib/actions";
import {
  SalesActivityFields,
  type OpportunityOption,
} from "@/components/SalesActivityFields";
import { localToday } from "@/components/localToday";
import { Spinner } from "@/components/Spinner";

export function SalesActivityForm({
  leadId,
  opportunityOptions,
}: {
  leadId: string;
  opportunityOptions: readonly OpportunityOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * THE FORM CLOSES WHEN THE TRANSITION SETTLES, NOT WHEN THE ACTION RESOLVES.
   *
   * It used to close the instant `await createSalesActivity(...)` returned,
   * which is EARLIER than the moment the logged activity reaches the screen.
   * Measured in a real browser on production, with the clock started on the
   * Save click (CLAUDE.md, "A successful write can show up as an empty list"):
   *
   *     Save pressed                        t0
   *     action resolved, form CLOSED     1,251 ms
   *     row repainted with the new value 3,502 ms
   *
   * So for ~2.25 seconds the form was gone — telling the salesperson the save
   * had finished — while the list behind it still showed the old activities.
   * That window is the whole of issue #163: the thing you were filling in
   * disappears, confirming the save worked, and the screen contradicts you.
   * Two separate click-throughs reported it as a lost update; it is a UI bug
   * and the row was committed every time.
   *
   * `isPending` is false only once the transition's own re-render has
   * committed, so running the close from here closes the form onto fresh data.
   * `router.refresh()` stays inside the transition deliberately: it is what
   * keeps `isPending` true until the refreshed tree lands, so the gate below
   * is waiting on the repaint rather than on the round trip. The reset moves
   * with the close for the same reason — blanking the fields at 1.25s while
   * the form is still on screen until 3.5s trades one wrong frame for another.
   *
   * THE COST, stated because it is real and visible: a successful save now
   * leaves this form open about two seconds longer. The Save button is
   * disabled, `aria-busy` and spinning for all of it, so the delay reads as
   * work in progress rather than as nothing having happened — which is the
   * right trade, because a form that closes onto stale data is worse than one
   * that takes two seconds.
   *
   * PORTED FROM `components/ActionForm.tsx` RATHER THAN CONVERTING TO IT, and
   * the reason is the Cancel button beside Save. `ActionForm` owns its own
   * transition and exposes no `isPending`, so a converted form could not keep
   * Cancel disabled in flight — and a Cancel clicked at 1.5s would close the
   * form onto stale data by hand, which is the defect arriving through a
   * different door. It would also move the refusal below the buttons (the
   * wrapper renders its error after all children) and change the throw copy.
   * Those are visible changes to a screen in use and none of them is this fix.
   */
  const settle = useRef<null | (() => void)>(null);
  useEffect(() => {
    if (isPending || settle.current === null) return;
    const run = settle.current;
    settle.current = null;
    run();
  }, [isPending]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
      >
        Log an activity
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await createSalesActivity(leadId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            // Queued rather than run: what this save produced has not
            // reached the screen yet. See `settle` above.
            settle.current = () => {
              formRef.current?.reset();
              setIsOpen(false);
            };
          } catch {
            setError("Could not log this activity");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink-label">Log an activity</h3>

      <SalesActivityFields
        // localToday(), not the server's date: this form only ever renders
        // after a click, so there is no server markup for it to disagree
        // with, and someone logging a call at 5pm in Los Angeles must not
        // have it dated tomorrow.
        defaults={{
          type: "CALL",
          occurredOn: localToday(),
          summary: "",
          followUpOn: null,
          opportunityId: null,
        }}
        opportunityOptions={opportunityOptions}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          // The same flag that disables it, so the two cannot disagree about
          // whether the form is in flight. `SubmitButton` does this for the
          // forms that use it; this one is hand-rolled and had no aria-busy,
          // so the two seconds the fix above adds were silent to a screen
          // reader.
          aria-busy={isPending || undefined}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            "Save"
          )}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
