"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that disables itself while its form is in flight.
 *
 * Every create in this app was a plain `<button>` inside a server-rendered
 * `<form action={serverAction}>`, which stays clickable for the entire
 * round trip. A second click submits the form again, and a create action
 * has nothing to make that idempotent — so an impatient user, or a slow
 * request, or a page that looks like it did nothing, produces two records
 * with no error anywhere. The CHANGELOG records exactly that shape: a save
 * that committed while the page reported the row wasn't there, "so the
 * failure mode of an exhausted pool is DUPLICATE RECORDS, silently."
 *
 * Whatever made the page look unsuccessful, the duplicate comes from the
 * second click, and the second click is preventable here regardless of the
 * cause.
 *
 * useFormStatus reads the status of the nearest enclosing form, which is
 * why this has to be its own client component rather than a prop on the
 * server-rendered button: the hook must run inside the form, in a child.
 * Outside a form it simply reports not-pending, so this stays safe to use
 * anywhere.
 */
export function SubmitButton({ children, disabled, ...props }: ComponentProps<"button">) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      // Tailwind's disabled: variants only fire on the real attribute, so
      // this reads as unavailable rather than merely inert.
      className={`${props.className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`.trim()}
    >
      {children}
    </button>
  );
}
