"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOpeningDeduction } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import { BUSINESS_SCOPE_QUESTIONS, type BusinessScopeAnswers } from "@/lib/businessScope";

/**
 * How this shop takes openings off the board — its own form, on purpose.
 *
 * ── THE BUG THIS SHAPE EXISTS TO FIX ──
 *
 * This question shipped as a fourth field inside `BusinessScopeFields`, and it
 * could not be saved. The three onboarding radios there are `required`, so the
 * BROWSER blocked the submit with a native tooltip on a different question
 * until all three were answered — which, for any company that skipped
 * onboarding, is never. The setting was on screen, selectable, and dead.
 *
 * Nothing in the test suite could see it. A census confirmed the question
 * rendered; a unit test confirmed it was not in the required list; both were
 * correct. It took somebody clicking Save. So the fix is structural rather
 * than a stronger assertion: its own form, its own action, nothing else on
 * either, so no other field's validation can take it down.
 *
 * ── TWO SMALLER THINGS, BOTH FROM THE SAME CLICK-THROUGH ──
 *
 * The options are VERTICAL. They were inline, copied from the yes/no questions'
 * row layout, and with three long labels they ran together — the reporter
 * noticed the radios nearly touching their labels. `contractingRelationship` is
 * the other three-option question here and it stacks, so this matches it.
 *
 * "Not set" is a REAL option rather than an omission. Null is a meaningful
 * answer — it resolves to the 32 sq ft the app has always used — and without a
 * control for it a shop could pick a convention and never get back to the
 * default. The click-through could not test clearing it for exactly that
 * reason.
 */
export function OpeningDeductionForm({
  answer,
  isOwner,
}: {
  answer: BusinessScopeAnswers["openingDeduction"];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-body">
        Most subs bid the wall solid — the board is still hung, cut out and framed with a header, so
        deducting a door bills none of that work. A 3&prime;&times;7&prime; door is 21 sq ft; a storefront
        is many times that.
      </p>

      {!isOwner && <p className="text-sm text-ink-muted">Only the account owner can change this.</p>}

      {isOwner && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            setSaved(false);
            startTransition(async () => {
              // Same net as the other settings forms: production redacts a
              // thrown Server Action message to a digest, so a failure becomes
              // a sentence here instead of taking Settings to the error
              // boundary.
              try {
                const result = await saveOpeningDeduction(formData);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setSaved(true);
                router.refresh();
              } catch {
                setError("Couldn't save just now. Nothing was changed — try again.");
              }
            });
          }}
          className="flex flex-col gap-4"
        >
          <fieldset>
            <legend className="mb-1 text-sm text-ink-label">
              {BUSINESS_SCOPE_QUESTIONS.openingDeduction.prompt}
            </legend>
            {/* Stacked, not a row — three long labels inline ran into each other. */}
            <div className="flex flex-col gap-2">
              {BUSINESS_SCOPE_QUESTIONS.openingDeduction.options.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="openingDeduction"
                    value={option.value}
                    defaultChecked={answer === option.value}
                    className="h-4 w-4 shrink-0"
                  />
                  {option.label}
                </label>
              ))}
              {/* ── THE WAY BACK TO THE DEFAULT, AND IT IS NOT A FOURTH CONVENTION ──
                  An empty value clears the column. Unanswered resolves to 32 sq ft
                  (`openingThresholdSqFt`), which is exactly what LARGE_ONLY resolves
                  to — so this option and "only the big ones" behave IDENTICALLY
                  today, and the label says so rather than implying a difference an
                  estimator would go looking for. A click-through caught the old
                  wording promising its own behaviour.

                  They are still worth separating: choosing an answer PINS this shop's
                  convention, while leaving it unanswered follows whatever C Stream
                  defaults to. Identical today, and only one of them stays identical
                  if that default ever moves. */}
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="radio"
                  name="openingDeduction"
                  value=""
                  defaultChecked={answer == null}
                  className="h-4 w-4 shrink-0"
                />
                Not answered — use C Stream&rsquo;s default, which today is the same as
                &ldquo;only the big ones&rdquo;
              </label>
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              // Byte-identical to `BusinessScopeSettingsForm`'s Save, deliberately.
              // `text-ink-on-brand` was invented here and is not a token this app
              // defines — Tailwind emits nothing for an undefined class, so the
              // label would have rendered with no colour at all on the yellow.
              // `colorTokenCensus` and `theme-contrast` both caught it; the
              // latter exists because white on this brand measured 1.53:1.
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? <Spinner /> : "Save"}
            </button>
            {saved && !isPending && <span className="text-sm text-ink-muted">Saved.</span>}
          </div>
        </form>
      )}
    </div>
  );
}
