"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBusinessScope, skipBusinessScopeQuestions } from "@/lib/actions";
import { BusinessScopeFields } from "@/components/BusinessScopeFields";
import { UNANSWERED_SCOPE } from "@/lib/businessScope";

/**
 * The three onboarding questions — now the whole screen, not a card over
 * one. Rendered only by `app/welcome/page.tsx`, which is outside the
 * `(app)` route group on purpose: no `<Sidebar>`, no `<Topbar>`, nothing
 * rendered behind this. That is the fix for the defect this replaces
 * (`CompanySetupPrompt.tsx`, deleted): a modal mounted in the shared
 * layout painted this card OVER whatever page the person happened to be
 * on, so the sidebar it exists to shape had already been seen — the
 * founder watched it happen over `/messages`. The first four seconds
 * this feature is trying to own were already spent by the time the card
 * appeared. Making this a real page the person lands ON, before the app
 * shell exists at all, is the actual fix; `app/welcome/page.tsx` and
 * `lib/onboarding-gate.ts` own getting them here and away again — this
 * component only asks the questions once they have arrived.
 *
 * COPY, UNCHANGED IN SUBSTANCE, REORDERED ON REQUEST. The three questions
 * (`lib/businessScope.ts`), the "twenty seconds" line and the "nothing is
 * ever hidden for good, change it in Settings" reassurance are the exact
 * same sentences `CompanySetupPrompt` shipped with — Cyrus saw them live
 * and asked only for where they sit, not what they say. They opened as one
 * dense paragraph above the form; a short, plain "why am I being asked
 * this" sentence now leads instead, and the reassurance moved to a quiet
 * line under the questions, closer to the buttons it is really about.
 *
 * NEVER A DEAD END. "Skip for now" is a first-class choice, not a hack
 * around a required screen — skipping records that the prompt was shown
 * (`skipBusinessScopeQuestions`), so it is never asked again, and per
 * lib/businessScope.ts's `hasNoScopeAnswers` that is the SAME state as
 * every company that predates this feature: everything shown, nothing
 * narrowed. There is no backdrop and no Escape handler here on purpose —
 * this is a page, not a dialog sitting over one, so there is nothing to
 * dismiss TO. Leaving without clicking either button (closing the tab,
 * navigating away by typing a new URL) simply means the question is still
 * open next time `/dashboard` is reached — not a bug, the honest state of
 * "was not actually asked yet."
 */
export function CompanySetupGate() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const skip = () => {
    setError(null);
    startTransition(async () => {
      const result = await skipBusinessScopeQuestions();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace("/dashboard");
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-line-card bg-surface p-8">
        <h1 className="text-xl font-semibold text-ink">A few questions about how you work</h1>
        {/* The lead sentence Cyrus asked for: one line, plain, answers "why
            am I being asked this" before anything else does. */}
        <p className="mt-2 text-sm text-ink-body">
          This helps us set C Stream up around the way you actually work.
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
              router.replace("/dashboard");
            });
          }}
          className="mt-8 flex flex-col gap-8"
        >
          <BusinessScopeFields defaults={UNANSWERED_SCOPE} spacious />

          {error && (
            <p role="alert" className="rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          {/* The reassurance, moved here and quieted rather than rewritten
              — same sentence CompanySetupPrompt opened with. */}
          <p className="text-xs text-ink-muted">
            Takes about twenty seconds, and nothing is ever hidden for good: skip it, or change your
            answers later in Settings, and everything is one search away regardless.
          </p>

          <div className="flex items-center justify-between gap-3">
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
    </main>
  );
}
