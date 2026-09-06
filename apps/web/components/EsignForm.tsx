"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signRequest } from "@/lib/actions";

/**
 * The signing form on /esign/[token] — the one form in this app whose user
 * has no account, no session, and no way to ask anybody what happened.
 *
 * IT WAS A BARE `<button>` IN A SERVER-RENDERED `<form action={…}>`.
 * Everything else in the app moved to SubmitButton for exactly this reason
 * and this form was missed, which matters more here than anywhere:
 *
 *   1. the button stayed clickable for the whole round trip, so an
 *      impatient GC on a slow connection clicked twice;
 *   2. `signRequest` did check-then-act — read the row, test its status,
 *      then update — so the second click read a row the first had already
 *      signed and THREW;
 *   3. there was no `app/error.tsx` at the root, so the anonymous routes
 *      had no boundary at all and the throw fell through to Next's default
 *      screen;
 *   4. production redacts a thrown Server Action message to a digest.
 *
 * Net result: the signature COMMITS, and the general contractor — the
 * person the sub most wants to look competent in front of — is looking at
 * an unexplained server error on a legal document. The reasonable
 * conclusion from that screen is that it failed.
 *
 * So: the button disables itself while in flight (here, via `isPending`,
 * rather than SubmitButton, because this form needs the action's RESULT and
 * therefore submits through a transition rather than the form action);
 * `signRequest` returns `{ ok }` instead of throwing; and a refusal renders
 * as a sentence on this page in words a stranger can act on.
 *
 * The success path refreshes rather than rendering its own confirmation.
 * The signed view is server-rendered from the frozen snapshot, which is the
 * record — a client-side "thank you" would be a second, unverified account
 * of what just happened.
 */
export function EsignForm({ token, defaultName, defaultEmail }: {
  token: string;
  defaultName: string;
  defaultEmail: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await signRequest(token, formData);
          if (result.ok) {
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      className="mt-6 flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-6"
    >
      <h2 className="text-lg font-semibold text-slate-100">Sign to accept</h2>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Your full name
        <input
          name="signerName"
          required
          defaultValue={defaultName}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Email (optional)
        <input
          name="signerEmail"
          type="email"
          defaultValue={defaultEmail}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" name="agree" required className="mt-1" />
        <span>
          I have reviewed the scope and pricing above and agree that typing my name and submitting
          this form constitutes my legal signature accepting this contract.
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending || undefined}
        className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Signing…" : "Sign contract"}
      </button>
    </form>
  );
}
