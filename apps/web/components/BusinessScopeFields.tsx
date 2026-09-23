"use client";

import { labelClass } from "@/components/RfiFields";
import { BUSINESS_SCOPE_QUESTIONS, type BusinessScopeAnswers } from "@/lib/businessScope";

/**
 * The three onboarding questions, as one form fragment shared by the
 * full-page onboarding gate (`CompanySetupGate.tsx`, `/welcome`) and the
 * Settings edit form (`BusinessScopeSettingsForm.tsx`) — one component for
 * both, same rule as every other create/edit pair in this app
 * (`ContactFields.tsx`, `TimeEntryFields.tsx`). THE WORDING OF THE THREE
 * QUESTIONS LIVES IN `lib/businessScope.ts`'s `BUSINESS_SCOPE_QUESTIONS`
 * and nowhere else — this component only lays it out.
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
 *
 * `spacious` is a presentation-only switch, not a second copy of the
 * questions. Settings renders this inline among several other compact
 * forms on one page and keeps the default, tight spacing. `/welcome` is
 * the first screen of the product with nothing else competing for
 * attention, and Cyrus's own read of it live was that it "reads as a
 * dense form in a box" — `spacious` widens the gap between the three
 * questions so they read as three separate decisions rather than one
 * block, and gives the question text itself the weight to be the thing a
 * reader's eye lands on, while the answer OPTIONS stay a visibly quieter
 * size underneath it.
 */
export function BusinessScopeFields({
  defaults,
  spacious = false,
}: {
  defaults: BusinessScopeAnswers;
  spacious?: boolean;
}) {
  const legendClass = spacious ? "block text-base font-medium text-ink" : "mb-1 text-sm text-ink-label";
  const optionsWrapClass = spacious ? "mt-3 flex flex-col gap-3" : "flex flex-col gap-2";
  const optionsRowClass = spacious ? "mt-3 flex gap-6" : "flex gap-4";
  const optionClass = spacious ? "text-base text-ink-body" : "text-sm text-ink";
  const fieldsetClass = spacious ? "flex flex-col" : labelClass;

  return (
    <div className={spacious ? "flex flex-col gap-8" : "flex flex-col gap-5"}>
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>{BUSINESS_SCOPE_QUESTIONS.contractingRelationship.prompt}</legend>
        <div className={optionsWrapClass}>
          {BUSINESS_SCOPE_QUESTIONS.contractingRelationship.options.map((option) => (
            <label key={option.value} className={`flex items-center gap-2 ${optionClass}`}>
              <input
                type="radio"
                name="contractingRelationship"
                value={option.value}
                defaultChecked={defaults.contractingRelationship === option.value}
                // `required` on a radio group makes the browser refuse a Save
                // with that question unanswered, with its own tooltip on the
                // group — before any request is made. `saveBusinessScope`
                // requires all three anyway; this just says so a step earlier.
                required
                className="h-4 w-4 shrink-0"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>{BUSINESS_SCOPE_QUESTIONS.doesPublicWork.prompt}</legend>
        <YesNo name="doesPublicWork" value={defaults.doesPublicWork} rowClass={optionsRowClass} optionClass={optionClass} />
      </fieldset>

      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>{BUSINESS_SCOPE_QUESTIONS.filesMonthlyPayApps.prompt}</legend>
        <YesNo
          name="filesMonthlyPayApps"
          value={defaults.filesMonthlyPayApps}
          rowClass={optionsRowClass}
          optionClass={optionClass}
        />
      </fieldset>
    </div>
  );
}

function YesNo({
  name,
  value,
  rowClass,
  optionClass,
}: {
  name: string;
  value: boolean | null;
  rowClass: string;
  optionClass: string;
}) {
  return (
    <div className={rowClass}>
      <label className={`flex items-center gap-2 ${optionClass}`}>
        <input type="radio" name={name} value="true" defaultChecked={value === true} required className="h-4 w-4 shrink-0" />
        Yes
      </label>
      <label className={`flex items-center gap-2 ${optionClass}`}>
        <input type="radio" name={name} value="false" defaultChecked={value === false} required className="h-4 w-4 shrink-0" />
        No
      </label>
    </div>
  );
}
