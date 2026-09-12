"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMember } from "@/lib/actions";

/**
 * The invite form, which now says why an invite did not happen.
 *
 * `inviteTeamMember` threw all three of its refusals — email missing, address
 * already has an account, address already invited — and production redacts a
 * thrown Server Action message to a digest. So the form reset and the pending
 * list did not grow, with nothing anywhere saying which of the three it was.
 * The duplicate-invite case was worse than silent: its guard tested
 * `instanceof Prisma.PrismaClientKnownRequestError`, which is false at runtime
 * under this bundling, so a second invite to the same address 500'd the page.
 * Both halves are fixed in the action; this renders the sentence.
 */
export function InviteTeamMemberForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
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
            setError("Could not send this invite");
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
