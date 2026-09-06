"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMember } from "@/lib/actions";

/**
 * The invite form, as a client component so the refusal can be READ.
 *
 * It was `<form action={inviteTeamMember}>` — a bare server-action form —
 * and every way that action could refuse was a `throw`. Production redacts a
 * thrown Server Action message to a digest, so "Someone with that email
 * already has an account" and "That email has already been invited" both
 * reached the owner as an unreadable error page. The second one could not be
 * reached at all until #25 was fixed, which is how the redaction went
 * unnoticed: nobody ever saw the sentence to miss it.
 *
 * Same shape as ContactPersonForm and the rest of the list-page forms:
 * render `result.error` inline, and disable the button while the action is
 * in flight so a refusal cannot invite a second click. That last part is a
 * scar of its own (#19) — no create action here is idempotent.
 */
export function InviteTeamMemberForm() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await inviteTeamMember(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            formRef.current?.reset();
          } catch {
            // A genuine bug rather than a refusal — the action returns all
            // of those. Deliberately does not echo the caught value: in
            // production it is a digest, and printing one at the person
            // reads as a reason while carrying none.
            setError("Could not send this invitation. Reload the page before trying again.");
          }
        });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Email
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Inviting…" : "Invite"}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}
