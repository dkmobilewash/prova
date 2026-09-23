"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions/shared";

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
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  errorClassName = "w-full text-sm text-tag-rose-ink",
  onSuccess,
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
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        // Read the FormData SYNCHRONOUSLY: `event.currentTarget` is null by
        // the time the transition's callback runs.
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (result && !result.ok) {
              // Nothing typed is lost — no reset on this branch, so every
              // field is still on screen next to the reason it didn't save.
              setError(result.error);
              return;
            }
            if (resetOnSuccess) formRef.current?.reset();
            onSuccess?.();
          } catch {
            setError("That didn't save. Reload the page and check before trying again.");
          }
        });
      }}
    >
      {children}
      {error && (
        <p role="alert" className={errorClassName}>
          {error}
        </p>
      )}
    </form>
  );
}
