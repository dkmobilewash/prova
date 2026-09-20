"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBusinessScope, skipBusinessScopeQuestions } from "@/lib/actions";
import { BusinessScopeFields } from "@/components/BusinessScopeFields";
import { UNANSWERED_SCOPE } from "@/lib/businessScope";

/**
 * The three onboarding questions, asked once, right after signup.
 *
 * Mounted in app/(app)/layout.tsx next to <FullTour>, for the same reason:
 * it needs to show up the first time ANY page loads, not one particular
 * page. `show` is computed server-side there — `role === "OWNER" &&
 * company.businessScopeAskedAt === null` — so a MEMBER never sees this at
 * all (they cannot answer it; see saveBusinessScope's owner-only refusal)
 * and an already-answered or already-skipped company never sees it again.
 *
 * NEVER A DEAD END. The backdrop, Escape and the visible "Skip for now"
 * button all run the exact same skip — there is no way to get this on
 * screen and have no way off it short of answering. Skipping is a first-
 * class choice here, not a hack around a required dialog: the spec is
 * explicit that skipping must show everything, same as never being asked.
 *
 * `dismissed` hides it locally the instant Save or Skip succeeds, rather
 * than waiting on `router.refresh()` to re-run the server layout and hand
 * back a new `show={false}` — the same reason FullTourOffer reads its own
 * dismissal from localStorage instead of waiting on a round trip. The
 * refresh is still called, so navigating (which remounts nothing, but does
 * re-read the layout's server data) does not re-arm the prompt.
 */
export function CompanySetupPrompt({ show }: { show: boolean }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!show || dismissed) return null;

  const skip = () => {
    setError(null);
    startTransition(async () => {
      const result = await skipBusinessScopeQuestions();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDismissed(true);
      router.refresh();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-setup-prompt-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-8"
      onKeyDown={(event) => {
        if (event.key === "Escape") skip();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) skip();
      }}
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line-card bg-surface p-6 shadow-2xl">
        <h2 id="company-setup-prompt-title" className="mb-1 text-lg font-semibold text-ink">
          A few questions about how you work
        </h2>
        <p className="mb-5 text-sm text-ink-body">
          C Stream covers a lot of ground — more than some businesses need on screen at once. Answer
          these three and we will only show what your work actually calls for. Takes about twenty
          seconds, and nothing is ever hidden for good: skip it, or change your answers later in
          Settings, and everything is one search away regardless.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await saveBusinessScope(formData);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setDismissed(true);
              router.refresh();
            });
          }}
          className="flex flex-col gap-5"
        >
          <BusinessScopeFields defaults={UNANSWERED_SCOPE} />

          {error && (
            <p role="alert" className="rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={skip}
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
