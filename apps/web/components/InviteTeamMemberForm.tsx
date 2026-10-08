"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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

  /**
   * The reset, held until the invite is on screen.
   *
   * This form has nothing to close — it is always on the page, above the
   * pending-invite list — so the cleared field IS the whole success signal,
   * and clearing it when the action resolves says "sent" while the list
   * below still has not grown. `router.refresh()` stays inside the
   * transition, so `isPending` is true until the refreshed tree COMMITS;
   * production measured those two moments 2.25 s apart. Issue #163.
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
            // Queued rather than run: the invite this sent has not reached
            // the list below yet. See `settle` above.
            settle.current = () => {
              formRef.current?.reset();
            };
          } catch {
            setError("Could not send this invite");
          }
        });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Email
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="w-64 rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending || undefined}
        className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
      >
        {isPending ? "Inviting…" : "Invite"}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}
