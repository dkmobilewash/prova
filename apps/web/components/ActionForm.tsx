"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions/shared";
import { clearFieldErrors, showFieldErrors } from "@/components/formFieldErrors";
import { setUnsaved } from "@/components/leaveGuard";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/**
 * A form that RENDERS what its action returned.
 *
 * WHY IT EXISTS. Six pages in this app are server components holding a
 * plain `<form action={serverAction}>`: the billing tab's invoice form, the
 * retainage tab's two, the estimate tab's line-item forms, the catalog
 * defaults, a contact's bid amount, and the settings bonding figures. A
 * server component has no state and no place to put a returned sentence, so
 * the house answer has always been "that action throws, and the error
 * boundary catches it" — which production redacts to the digest paragraph:
 *
 *   "An error occurred in the Server Components render. The specific
 *    message is omitted in production builds…"
 *
 * That paragraph is what a contractor got for typing a quantity of `2,800`.
 * The parsing is tolerant now, so that particular figure saves — but a
 * genuinely unreadable one still has to say so, and it cannot say so
 * through a boundary. This is the smallest thing that gives those six
 * pages somewhere to say it: swap `<form action={fn}>` for
 * `<ActionForm action={fn}>` and the children are untouched.
 *
 * IT IS `onSubmit`, NOT THE `action` PROP, and that is not a style choice.
 * React 19 calls `requestFormReset` unconditionally before running a form's
 * `action`, so a refusal arrives over fields that have already snapped back
 * to their defaults — the person is told what was wrong with choices no
 * longer on screen. `components/formActionCensus.test.ts` fails the build
 * on it. Reset happens here only after `{ ok: true }`.
 *
 * THE ACTION MAY RETURN NOTHING. Several of these actions are still
 * throw-style for their other guards and simply return `undefined` on
 * success; `undefined` is treated as success, so converting a page does not
 * require converting every guard in the action behind it on the same day.
 * A thrown error is still caught and shown — redacted in production, which
 * is right, because by then it is a bug rather than something typed.
 *
 * WHERE A REFUSAL APPEARS. A failure carrying `fieldErrors` (keyed by input
 * `name`) puts each message under its input, marks it `aria-invalid`, and
 * moves focus to the first one — a contractor fixing a long form no longer
 * hunts for which box the bottom sentence meant. The sentence still renders
 * at the bottom as an alert; with no field to point at, it is scrolled into
 * view instead, so a refusal is never off-screen.
 *
 * NOT LOSING WORK. Once anything is typed, leaving the page (tab close,
 * reload, or an in-app link) asks first — see `leaveGuard.ts` — until a save
 * succeeds. `draftKey` additionally keeps the typing in sessionStorage via
 * `useFormDraft` and brings it back next time the form mounts. The key
 * carries the row's id for an edit form, so two rows never trade drafts.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  errorClassName = "w-full text-sm text-tag-rose-ink",
  onSuccess,
  draftKey,
}: {
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Optional only so `createElement(ActionForm, props, …children)` resolves
   * in a `.ts` test — the unit suite has no JSX, and a required `children`
   * prop forces the shape `react/no-children-prop` forbids. A form with no
   * children renders an empty form, which is harmless and never happens. */
  children?: ReactNode;
  className?: string;
  /** Off for an edit form, where putting every field back to its stored
   * value after a successful save is not what a reset does. */
  resetOnSuccess?: boolean;
  errorClassName?: string;
  onSuccess?: () => void;
  /** Opt in to draft saving; see `useFormDraft` for how to pick the key. */
  draftKey?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFieldErrors, setHasFieldErrors] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // A stable identity for the leave guard; released on unmount.
  const [guardToken] = useState(() => ({}));
  useEffect(() => () => setUnsaved(guardToken, false), [guardToken]);
  // Always called (hook rules); inert unless `draftKey` wires it up below.
  const draft = useFormDraft(draftKey ?? "", { onDiscard: () => setUnsaved(guardToken, false) });
  const draftRef = draft.formRef;
  const attach = useCallback(
    (form: HTMLFormElement | null) => {
      formRef.current = form;
      if (draftKey) draftRef(form);
    },
    [draftKey, draftRef],
  );

  useEffect(() => {
    if (error && !hasFieldErrors) errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error, hasFieldErrors]);
  const [isPending, startTransition] = useTransition();

  /**
   * THE SUCCESS HANDLER WAITS FOR THE TRANSITION, NOT FOR THE ACTION.
   *
   * It used to run the instant `await action(formData)` resolved, which is
   * EARLIER than the moment the saved data reaches the screen. Measured in a
   * real browser on production, editing a bid quote's expiry:
   *
   *     Save pressed                        t0
   *     action resolved, form closed     1,251 ms
   *     row repainted with the new value 3,502 ms
   *
   * So for ~2.25 seconds the form was gone — telling the estimator the save
   * had finished — while the row behind it still showed the OLD value. That
   * window is why this reads as a lost update: the thing you were editing
   * disappears, confirming the action worked, and the screen contradicts you.
   * A click-through reported it as a bug twice before anybody timed it.
   *
   * `isPending` is false only once the transition's own re-render has
   * committed, so firing the callback from there closes the form onto fresh
   * data instead of stale data. The reset moves with it for the same reason:
   * blanking the fields at 1.25s while the form stays on screen until 3.5s
   * would trade one wrong frame for another.
   *
   * THE COST, stated because it is real: a successful save now leaves the form
   * open ~2s longer. The button is disabled and spinning for all of it —
   * `useFormStatus` works here, which `actionForm.test.ts` measured and pins —
   * so the delay reads as work in progress rather than as nothing happening.
   */
  const settle = useRef<null | (() => void)>(null);
  useEffect(() => {
    if (isPending || settle.current === null) return;
    const run = settle.current;
    settle.current = null;
    run();
  }, [isPending]);

  return (
    <form
      ref={attach}
      className={className}
      onChange={(event) => {
        setUnsaved(guardToken, true);
        const name = (event.target as { name?: string }).name;
        if (name) clearFieldErrors(event.currentTarget, name);
        if (draftKey) draft.save();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        // Read the FormData SYNCHRONOUSLY: `event.currentTarget` is null by
        // the time the transition's callback runs.
        const formData = new FormData(event.currentTarget);
        const form = event.currentTarget;
        setError(null);
        setHasFieldErrors(false);
        clearFieldErrors(form);
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (result && !result.ok) {
              // Nothing typed is lost — no reset on this branch, so every
              // field is still on screen next to the reason it didn't save.
              setError(result.error);
              const first = result.fieldErrors ? showFieldErrors(form, result.fieldErrors) : null;
              setHasFieldErrors(first !== null);
              first?.focus();
              return;
            }
            // Queued rather than run: the data this save produced has not
            // reached the screen yet. See `settle` above.
            setUnsaved(guardToken, false);
            if (draftKey) draft.clear();
            settle.current = () => {
              if (resetOnSuccess) formRef.current?.reset();
              onSuccess?.();
            };
          } catch {
            setError("That didn't save. Reload the page and check before trying again.");
          }
        });
      }}
    >
      {draftKey && <FormDraftNotice draft={draft} />}
      {children}
      {error && (
        <p ref={errorRef} role="alert" className={errorClassName}>
          {error}
        </p>
      )}
    </form>
  );
}
