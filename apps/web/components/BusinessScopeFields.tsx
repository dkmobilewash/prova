"use client";

import { labelClass } from "@/components/RfiFields";
import { BUSINESS_SCOPE_QUESTIONS, type BusinessScopeAnswers } from "@/lib/businessScope";

/**
 * The three onboarding questions, as one form fragment shared by the
 * onboarding prompt (`CompanySetupPrompt.tsx`) and the Settings edit form
 * (`BusinessScopeSettingsForm.tsx`) — one component for both, same rule as
 * every other create/edit pair in this app (`ContactFields.tsx`,
 * `TimeEntryFields.tsx`).
 *
 * Radios, not selects: three short questions asked once are read faster as
 * options already on screen than as three dropdowns to open. Uncontrolled
 * (`defaultChecked`) — the parent reads them with `new FormData`, the house
 * pattern (see LogTimeEntryForm.tsx's file comment) — so this component
 * holds no state of its own and cannot drift from what the parent submits.
 *
 * `defaults` is the full three-answer shape so this can render either a
 * blank first-time form (all null — nothing pre-checked) or the settings
 * edit form seeded with the company's current answers.
 */
export function BusinessScopeFields({ defaults }: { defaults: BusinessScopeAnswers }) {
  return (
    <div className="flex flex-col gap-5">
      <fieldset className={labelClass}>
        <legend className="mb-1 text-sm text-ink-label">
          {BUSINESS_SCOPE_QUESTIONS.contractingRelationship.prompt}
        </legend>
        <div className="flex flex-col gap-2">
          {BUSINESS_SCOPE_QUESTIONS.contractingRelationship.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="contractingRelationship"
                value={option.value}
                defaultChecked={defaults.contractingRelationship === option.value}
                className="h-4 w-4"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={labelClass}>
        <legend className="mb-1 text-sm text-ink-label">{BUSINESS_SCOPE_QUESTIONS.doesPublicWork.prompt}</legend>
        <YesNo name="doesPublicWork" value={defaults.doesPublicWork} />
      </fieldset>

      <fieldset className={labelClass}>
        <legend className="mb-1 text-sm text-ink-label">
          {BUSINESS_SCOPE_QUESTIONS.filesMonthlyPayApps.prompt}
        </legend>
        <YesNo name="filesMonthlyPayApps" value={defaults.filesMonthlyPayApps} />
      </fieldset>
    </div>
  );
}

function YesNo({ name, value }: { name: string; value: boolean | null }) {
  return (
    <div className="flex gap-4">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="radio" name={name} value="true" defaultChecked={value === true} className="h-4 w-4" />
        Yes
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="radio" name={name} value="false" defaultChecked={value === false} className="h-4 w-4" />
        No
      </label>
    </div>
  );
}
