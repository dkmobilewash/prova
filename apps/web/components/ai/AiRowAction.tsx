"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/shared";
import { Spinner } from "@/components/Spinner";

/**
 * One tap on a recommendation or finding: Dismiss, or Done. No two-step
 * confirm — both are reversible (the row keeps its data and can be
 * restored), and a confirm on something that loses nothing is friction.
 *
 * The action arrives as a prop (a Server Action handed down by the page)
 * so this file imports no feature module, and the render tests can hand it
 * a plain function. The action revalidates /ai; the row then leaves the
 * list on the re-render. A refusal is shown, never thrown — production
 * redacts a thrown Server Action message. While it runs the same word
 * stays, with a spinner beside it (components/Spinner.tsx).
 */
export function AiRowAction({
  id,
  action,
  label,
}: {
  id: string;
  action: (id: string) => Promise<ActionResult>;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await action(id);
            if (!result.ok) setError(result.error);
          });
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink-muted hover:bg-rail-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
      >
        {isPending && <Spinner />}
        {label}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-danger">
        {error}
      </span>
    </span>
  );
}
