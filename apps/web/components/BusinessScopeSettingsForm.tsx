"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBusinessScope, clearBusinessScope } from "@/lib/actions";
import { BusinessScopeFields } from "@/components/BusinessScopeFields";
import { businessScopeLine, hasNoScopeAnswers, type BusinessScopeAnswers } from "@/lib/businessScope";

/**
 * Settings' half of the onboarding questions — "see and change it" from the
 * spec. Same three questions as the full-page onboarding gate
 * (`CompanySetupGate.tsx`, `/welcome`), same
 * `BusinessScopeFields`, same `saveBusinessScope` action, so re-answering
 * here and answering at signup can never drift into two different forms
 * asking two different things.
 *
 * Read-only for anyone but the owner: `saveBusinessScope`/`clearBusinessScope`
 * both refuse a non-owner, and rendering a form that can only ever come
 * back with that refusal is the "door that will not open" this codebase
 * avoids elsewhere (navItems.tsx's OWNER_ONLY_FOOTER) — so a non-owner gets
 * the readable line only, with no form under it.
 */
export function BusinessScopeSettingsForm({
  scope,
  isOwner,
}: {
  scope: BusinessScopeAnswers;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const line = businessScopeLine(scope);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-body">
        {line ?? "Not set up yet — every menu is shown until you answer these."}
      </p>

      {!isOwner && (
        <p className="text-sm text-ink-muted">Only the account owner can change this.</p>
      )}

      {isOwner && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              // Same net as CompanySetupGate, for the same action: a thrown
              // (redacted) failure becomes a sentence here instead of
              // taking the Settings page down to the (app) error boundary.
              try {
                const result = await saveBusinessScope(formData);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              } catch {
                setError("Couldn't save just now. Nothing was changed — try again.");
              }
            });
          }}
          className="flex flex-col gap-5"
        >
          <BusinessScopeFields defaults={scope} />

          {error && (
            <p role="alert" className="rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            {!hasNoScopeAnswers(scope) && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await clearBusinessScope();
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      router.refresh();
                    } catch {
                      setError("Couldn't change this just now. Nothing was changed — try again.");
                    }
                  });
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover hover:text-ink disabled:opacity-50"
              >
                Not sure — show me everything
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
